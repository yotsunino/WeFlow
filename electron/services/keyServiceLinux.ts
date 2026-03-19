import { app } from 'electron'
import { join } from 'path'
import { existsSync, readdirSync, statSync, readFileSync } from 'fs'
import { execFile, exec } from 'child_process'
import { promisify } from 'util'
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const execFileAsync = promisify(execFile)
const execAsync = promisify(exec)

type DbKeyResult = { success: boolean; key?: string; error?: string; logs?: string[] }
type ImageKeyResult = { success: boolean; xorKey?: number; aesKey?: string; error?: string }

export class KeyServiceLinux {
  private sudo: any

  constructor() {
    try {
      this.sudo = require('sudo-prompt');
    } catch (e) {
      console.error('Failed to load sudo-prompt', e);
    }
  }

  private getHelperPath(): string {
    const isPackaged = app.isPackaged
    const candidates: string[] = []
    if (process.env.WX_KEY_HELPER_PATH) candidates.push(process.env.WX_KEY_HELPER_PATH)
    if (isPackaged) {
      candidates.push(join(process.resourcesPath, 'resources', 'xkey_helper_linux'))
      candidates.push(join(process.resourcesPath, 'xkey_helper_linux'))
    } else {
      candidates.push(join(app.getAppPath(), 'resources', 'xkey_helper_linux'))
      candidates.push(join(app.getAppPath(), '..', 'Xkey', 'build', 'xkey_helper_linux'))
    }
    for (const p of candidates) {
      if (existsSync(p)) return p
    }
    throw new Error('找不到 xkey_helper_linux，请检查路径')
  }

  public async autoGetDbKey(
      timeoutMs = 60_000,
      onStatus?: (message: string, level: number) => void
  ): Promise<DbKeyResult> {
    try {
      onStatus?.('正在尝试结束当前微信进程...', 0)
      await execAsync('killall -9 wechat wechat-bin xwechat').catch(() => {})
      // 稍微等待进程完全退出
      await new Promise(r => setTimeout(r, 1000))

      onStatus?.('正在尝试拉起微信...', 0)
      const startCmds = [
        'nohup wechat >/dev/null 2>&1 &',
        'nohup wechat-bin >/dev/null 2>&1 &',
        'nohup xwechat >/dev/null 2>&1 &'
      ]
      for (const cmd of startCmds) execAsync(cmd).catch(() => {})

      onStatus?.('等待微信进程出现...', 0)
      let pid = 0
      for (let i = 0; i < 15; i++) { // 最多等 15 秒
        await new Promise(r => setTimeout(r, 1000))
        const { stdout } = await execAsync('pidof wechat wechat-bin xwechat').catch(() => ({ stdout: '' }))
        const pids = stdout.trim().split(/\s+/).filter(p => p)
        if (pids.length > 0) {
          pid = parseInt(pids[0], 10)
          break
        }
      }

      if (!pid) {
        const err = '未能自动启动微信，请手动启动并登录。'
        onStatus?.(err, 2)
        return { success: false, error: err }
      }

      onStatus?.(`捕获到微信 PID: ${pid}，准备获取密钥...`, 0)

      await new Promise(r => setTimeout(r, 2000))

      return await this.getDbKey(pid, onStatus)
    } catch (err: any) {
      const errMsg = '自动获取微信 PID 失败: ' + err.message
      onStatus?.(errMsg, 2)
      return { success: false, error: errMsg }
    }
  }

  public async getDbKey(pid: number, onStatus?: (message: string, level: number) => void): Promise<DbKeyResult> {
    try {
      const helperPath = this.getHelperPath()

      onStatus?.('正在扫描数据库基址...', 0)
      const { stdout: scanOut } = await execFileAsync(helperPath, ['db_scan', pid.toString()])
      const scanRes = JSON.parse(scanOut.trim())

      if (!scanRes.success) {
        const err = scanRes.result || '扫描失败，请确保微信已完全登录'
        onStatus?.(err, 2)
        return { success: false, error: err }
      }

      const targetAddr = scanRes.target_addr
      onStatus?.('基址扫描成功，正在请求管理员权限进行内存 Hook...', 0)

      return await new Promise((resolve) => {
        const options = { name: 'WeFlow' }
        const command = `"${helperPath}" db_hook ${pid} ${targetAddr}`

        this.sudo.exec(command, options, (error, stdout) => {
          execAsync(`kill -CONT ${pid}`).catch(() => {})
          if (error) {
            onStatus?.('授权失败或被取消', 2)
            resolve({ success: false, error: `授权失败或被取消: ${error.message}` })
            return
          }
          try {
            const hookRes = JSON.parse((stdout as string).trim())
            if (hookRes.success) {
              onStatus?.('密钥获取成功', 1)
              resolve({ success: true, key: hookRes.key })
            } else {
              onStatus?.(hookRes.result, 2)
              resolve({ success: false, error: hookRes.result })
            }
          } catch (e) {
            onStatus?.('解析 Hook 结果失败', 2)
            resolve({ success: false, error: '解析 Hook 结果失败' })
          }
        })
      })
    } catch (err: any) {
      onStatus?.(err.message, 2)
      return { success: false, error: err.message }
    }
  }

  public async autoGetImageKey(
      accountPath?: string,
      onProgress?: (msg: string) => void,
      wxid?: string
  ): Promise<ImageKeyResult> {
    try {
      onProgress?.('正在初始化缓存扫描...');
      const helperPath = this.getHelperPath()
      const { stdout } = await execFileAsync(helperPath, ['image_local'])
      const res = JSON.parse(stdout.trim())
      if (!res.success) return { success: false, error: res.result }

      const accounts = res.data.accounts || []
      let account = accounts.find((a: any) => a.wxid === wxid)
      if (!account && accounts.length > 0) account = accounts[0]

      if (account && account.keys && account.keys.length > 0) {
        onProgress?.(`已找到匹配的图片密钥 (wxid: ${account.wxid})`);
        const keyObj = account.keys[0]
        return { success: true, xorKey: keyObj.xorKey, aesKey: keyObj.aesKey }
      }
      return { success: false, error: '未在缓存中找到匹配的图片密钥' }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }

  public async autoGetImageKeyByMemoryScan(
      accountPath: string,
      onProgress?: (msg: string) => void
  ): Promise<ImageKeyResult> {
    try {
      onProgress?.('正在查找模板文件...')
      let result = await this._findTemplateData(accountPath, 32)
      let { ciphertext, xorKey } = result

      if (ciphertext && xorKey === null) {
        onProgress?.('未找到有效密钥，尝试扫描更多文件...')
        result = await this._findTemplateData(accountPath, 100)
        xorKey = result.xorKey
      }

      if (!ciphertext) return { success: false, error: '未找到 V2 模板文件，请先在微信中查看几张图片' }
      if (xorKey === null) return { success: false, error: '未能从模板文件中计算出有效的 XOR 密钥' }

      onProgress?.(`XOR 密钥: 0x${xorKey.toString(16).padStart(2, '0')}，正在查找微信进程...`)

      // 2. 找微信 PID
      const { stdout } = await execAsync('pidof wechat wechat-bin xwechat').catch(() => ({ stdout: '' }))
      const pids = stdout.trim().split(/\s+/).filter(p => p)
      if (pids.length === 0) return { success: false, error: '微信未运行，无法扫描内存' }
      const pid = parseInt(pids[0], 10)

      onProgress?.(`已找到微信进程 PID=${pid}，正在提权扫描进程内存...`);

      // 3. 将 Buffer 转换为 hex 传递给 helper
      const ciphertextHex = ciphertext.toString('hex')
      const helperPath = this.getHelperPath()

      try {
        console.log(`[Debug] 准备执行 Helper: ${helperPath} image_mem ${pid} ${ciphertextHex}`);

        const { stdout: memOut, stderr } = await execFileAsync(helperPath, ['image_mem', pid.toString(), ciphertextHex])

        console.log(`[Debug] Helper stdout: ${memOut}`);
        if (stderr) {
          console.warn(`[Debug] Helper stderr: ${stderr}`);
        }

        if (!memOut || memOut.trim() === '') {
          return { success: false, error: 'Helper 返回为空，请检查是否有足够的权限(如需sudo)读取进程内存。' }
        }

        const res = JSON.parse(memOut.trim())

        if (res.success) {
          onProgress?.('内存扫描成功');
          return { success: true, xorKey, aesKey: res.key }
        }
        return { success: false, error: res.result || '未知错误' }

      } catch (err: any) {
        console.error('[Debug] 执行或解析 Helper 时发生崩溃:', err);
        return {
          success: false,
          error: `内存扫描失败: ${err.message}\nstdout: ${err.stdout || '无'}\nstderr: ${err.stderr || '无'}`
        }
      }
    } catch (err: any) {
      return { success: false, error: `内存扫描失败: ${err.message}` }
    }
  }

  private async _findTemplateData(userDir: string, limit: number = 32): Promise<{ ciphertext: Buffer | null; xorKey: number | null }> {
    const V2_MAGIC = Buffer.from([0x07, 0x08, 0x56, 0x32, 0x08, 0x07])

    // 递归收集 *_t.dat 文件
    const collect = (dir: string, results: string[], maxFiles: number) => {
      if (results.length >= maxFiles) return
      try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (results.length >= maxFiles) break
          const full = join(dir, entry.name)
          if (entry.isDirectory()) collect(full, results, maxFiles)
          else if (entry.isFile() && entry.name.endsWith('_t.dat')) results.push(full)
        }
      } catch { /* 忽略无权限目录 */ }
    }

    const files: string[] = []
    collect(userDir, files, limit)

    // 按修改时间降序
    files.sort((a, b) => {
      try { return statSync(b).mtimeMs - statSync(a).mtimeMs } catch { return 0 }
    })

    let ciphertext: Buffer | null = null
    const tailCounts: Record<string, number> = {}

    for (const f of files.slice(0, 32)) {
      try {
        const data = readFileSync(f)
        if (data.length < 8) continue

        // 统计末尾两字节用于 XOR 密钥
        if (data.subarray(0, 6).equals(V2_MAGIC) && data.length >= 2) {
          const key = `${data[data.length - 2]}_${data[data.length - 1]}`
          tailCounts[key] = (tailCounts[key] ?? 0) + 1
        }

        // 提取密文（取第一个有效的）
        if (!ciphertext && data.subarray(0, 6).equals(V2_MAGIC) && data.length >= 0x1F) {
          ciphertext = data.subarray(0xF, 0x1F)
        }
      } catch { /* 忽略 */ }
    }

    // 计算 XOR 密钥
    let xorKey: number | null = null
    let maxCount = 0
    for (const [key, count] of Object.entries(tailCounts)) {
      if (count > maxCount) {
        maxCount = count
        const [x, y] = key.split('_').map(Number)
        const k = x ^ 0xFF
        if (k === (y ^ 0xD9)) xorKey = k
      }
    }

    return { ciphertext, xorKey }
  }
}