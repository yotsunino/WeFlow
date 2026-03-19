import { app } from 'electron'
import { wcdbService } from './wcdbService'

interface UsageStats {
  appVersion: string
  platform: string
  deviceId: string
  timestamp: number
  online: boolean
  pages: string[]
}

class CloudControlService {
  private deviceId: string = ''
  private timer: NodeJS.Timeout | null = null
  private pages: Set<string> = new Set()
  private platformVersionCache: string | null = null

  async init() {
    this.deviceId = this.getDeviceId()
    await wcdbService.cloudInit(300)
    await this.reportOnline()

    this.timer = setInterval(() => {
      this.reportOnline()
    }, 300000)
  }

  private getDeviceId(): string {
    const crypto = require('crypto')
    const os = require('os')
    const machineId = os.hostname() + os.platform() + os.arch()
    return crypto.createHash('md5').update(machineId).digest('hex')
  }

  private async reportOnline() {
    const data: UsageStats = {
      appVersion: app.getVersion(),
      platform: this.getPlatformVersion(),
      deviceId: this.deviceId,
      timestamp: Date.now(),
      online: true,
      pages: Array.from(this.pages)
    }

    await wcdbService.cloudReport(JSON.stringify(data))
    this.pages.clear()
  }

  private getPlatformVersion(): string {
    if (this.platformVersionCache) {
      return this.platformVersionCache
    }

    const os = require('os')
    const fs = require('fs')
    const platform = process.platform

    if (platform === 'win32') {
      const release = os.release()
      const parts = release.split('.')
      const major = parseInt(parts[0])
      const minor = parseInt(parts[1] || '0')
      const build = parseInt(parts[2] || '0')

      // Windows 11 是 10.0.22000+，且主版本必须是 10.0
      if (major === 10 && minor === 0 && build >= 22000) {
        this.platformVersionCache = 'Windows 11'
        return this.platformVersionCache
      } else if (major === 10) {
        this.platformVersionCache = 'Windows 10'
        return this.platformVersionCache
      }
      this.platformVersionCache = `Windows ${release}`
      return this.platformVersionCache
    }

    if (platform === 'darwin') {
      // `os.release()` returns Darwin kernel version (e.g. 25.3.0),
      // while cloud reporting expects the macOS product version (e.g. 26.3).
      const macVersion = typeof process.getSystemVersion === 'function' ? process.getSystemVersion() : os.release()
      this.platformVersionCache = `macOS ${macVersion}`
      return this.platformVersionCache
    }

    if (platform === 'linux') {
      try {
        const osReleasePaths = ['/etc/os-release', '/usr/lib/os-release']
        for (const filePath of osReleasePaths) {
          if (!fs.existsSync(filePath)) {
            continue
          }

          const content = fs.readFileSync(filePath, 'utf8')
          const values: Record<string, string> = {}

          for (const line of content.split('\n')) {
            const trimmed = line.trim()
            if (!trimmed || trimmed.startsWith('#')) {
              continue
            }

            const separatorIndex = trimmed.indexOf('=')
            if (separatorIndex <= 0) {
              continue
            }

            const key = trimmed.slice(0, separatorIndex)
            let value = trimmed.slice(separatorIndex + 1).trim()
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
              value = value.slice(1, -1)
            }
            values[key] = value
          }

          if (values.PRETTY_NAME) {
            this.platformVersionCache = values.PRETTY_NAME
            return this.platformVersionCache
          }

          if (values.NAME && values.VERSION_ID) {
            this.platformVersionCache = `${values.NAME} ${values.VERSION_ID}`
            return this.platformVersionCache
          }

          if (values.NAME) {
            this.platformVersionCache = values.NAME
            return this.platformVersionCache
          }
        }
      } catch (error) {
        console.warn('[CloudControl] Failed to detect Linux distro version:', error)
      }

      this.platformVersionCache = `Linux ${os.release()}`
      return this.platformVersionCache
    }

    this.platformVersionCache = platform
    return this.platformVersionCache
  }

  recordPage(pageName: string) {
    this.pages.add(pageName)
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    wcdbService.cloudStop()
  }

  async getLogs() {
    return wcdbService.getLogs()
  }
}

export const cloudControlService = new CloudControlService()

