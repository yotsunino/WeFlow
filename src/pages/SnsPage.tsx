import { useEffect, useLayoutEffect, useState, useRef, useCallback } from 'react'
import { RefreshCw, Search, X, Download, FolderOpen, FileJson, FileText, Image, CheckCircle, AlertCircle, Calendar, Users, Info, ChevronLeft, ChevronRight, Shield, ShieldOff } from 'lucide-react'
import JumpToDateDialog from '../components/JumpToDateDialog'
import './SnsPage.scss'
import { SnsPost } from '../types/sns'
import { SnsPostItem } from '../components/Sns/SnsPostItem'
import { SnsFilterPanel } from '../components/Sns/SnsFilterPanel'
import { Avatar } from '../components/Avatar'
import * as configService from '../services/config'

const SNS_PAGE_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const SNS_PAGE_CACHE_POST_LIMIT = 200
const SNS_PAGE_CACHE_SCOPE_FALLBACK = '__default__'
const CONTACT_COUNT_SORT_DEBOUNCE_MS = 200
const CONTACT_COUNT_BATCH_SIZE = 10

type ContactPostCountStatus = 'idle' | 'loading' | 'ready'

interface Contact {
    username: string
    displayName: string
    avatarUrl?: string
    type?: 'friend' | 'former_friend' | 'sns_only'
    lastSessionTimestamp?: number
    postCount?: number
    postCountStatus?: ContactPostCountStatus
}

interface ContactsCountProgress {
    resolved: number
    total: number
    running: boolean
}

interface SnsOverviewStats {
    totalPosts: number
    totalFriends: number
    myPosts: number | null
    earliestTime: number | null
    latestTime: number | null
}

type OverviewStatsStatus = 'loading' | 'ready' | 'error'

interface AuthorTimelineTarget {
    username: string
    nickname: string
    avatarUrl?: string
}

export default function SnsPage() {
    const [posts, setPosts] = useState<SnsPost[]>([])
    const [loading, setLoading] = useState(false)
    const [hasMore, setHasMore] = useState(true)
    const loadingRef = useRef(false)
    const [overviewStats, setOverviewStats] = useState<SnsOverviewStats>({
        totalPosts: 0,
        totalFriends: 0,
        myPosts: null,
        earliestTime: null,
        latestTime: null
    })
    const [overviewStatsStatus, setOverviewStatsStatus] = useState<OverviewStatsStatus>('loading')

    // Filter states
    const [searchKeyword, setSearchKeyword] = useState('')
    const [selectedUsernames, setSelectedUsernames] = useState<string[]>([])
    const [jumpTargetDate, setJumpTargetDate] = useState<Date | undefined>(undefined)

    // Contacts state
    const [contacts, setContacts] = useState<Contact[]>([])
    const [contactSearch, setContactSearch] = useState('')
    const [contactsLoading, setContactsLoading] = useState(false)
    const [contactsCountProgress, setContactsCountProgress] = useState<ContactsCountProgress>({
        resolved: 0,
        total: 0,
        running: false
    })

    // UI states
    const [showJumpDialog, setShowJumpDialog] = useState(false)
    const [debugPost, setDebugPost] = useState<SnsPost | null>(null)
    const [authorTimelineTarget, setAuthorTimelineTarget] = useState<AuthorTimelineTarget | null>(null)
    const [authorTimelinePosts, setAuthorTimelinePosts] = useState<SnsPost[]>([])
    const [authorTimelineLoading, setAuthorTimelineLoading] = useState(false)
    const [authorTimelineLoadingMore, setAuthorTimelineLoadingMore] = useState(false)
    const [authorTimelineHasMore, setAuthorTimelineHasMore] = useState(false)
    const [authorTimelineTotalPosts, setAuthorTimelineTotalPosts] = useState<number | null>(null)
    const [authorTimelineStatsLoading, setAuthorTimelineStatsLoading] = useState(false)

    // 导出相关状态
    const [showExportDialog, setShowExportDialog] = useState(false)
    const [exportFormat, setExportFormat] = useState<'json' | 'html' | 'arkmejson'>('html')
    const [exportFolder, setExportFolder] = useState('')
    const [exportImages, setExportImages] = useState(false)
    const [exportLivePhotos, setExportLivePhotos] = useState(false)
    const [exportVideos, setExportVideos] = useState(false)
    const [exportDateRange, setExportDateRange] = useState<{ start: string; end: string }>({ start: '', end: '' })
    const [isExporting, setIsExporting] = useState(false)
    const [exportProgress, setExportProgress] = useState<{ current: number; total: number; status: string } | null>(null)
    const [exportResult, setExportResult] = useState<{ success: boolean; filePath?: string; postCount?: number; mediaCount?: number; error?: string } | null>(null)
    const [refreshSpin, setRefreshSpin] = useState(false)
    const [calendarPicker, setCalendarPicker] = useState<{ field: 'start' | 'end'; month: Date } | null>(null)
    const [showYearMonthPicker, setShowYearMonthPicker] = useState(false)

    // 触发器相关状态
    const [showTriggerDialog, setShowTriggerDialog] = useState(false)
    const [triggerInstalled, setTriggerInstalled] = useState<boolean | null>(null)
    const [triggerLoading, setTriggerLoading] = useState(false)
    const [triggerMessage, setTriggerMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

    const postsContainerRef = useRef<HTMLDivElement>(null)
    const [hasNewer, setHasNewer] = useState(false)
    const [loadingNewer, setLoadingNewer] = useState(false)
    const postsRef = useRef<SnsPost[]>([])
    const overviewStatsRef = useRef<SnsOverviewStats>(overviewStats)
    const overviewStatsStatusRef = useRef<OverviewStatsStatus>(overviewStatsStatus)
    const selectedUsernamesRef = useRef<string[]>(selectedUsernames)
    const searchKeywordRef = useRef(searchKeyword)
    const jumpTargetDateRef = useRef<Date | undefined>(jumpTargetDate)
    const cacheScopeKeyRef = useRef('')
    const scrollAdjustmentRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null)
    const contactsLoadTokenRef = useRef(0)
    const contactsCountHydrationTokenRef = useRef(0)
    const contactsCountBatchTimerRef = useRef<number | null>(null)
    const authorTimelinePostsRef = useRef<SnsPost[]>([])
    const authorTimelineLoadingRef = useRef(false)
    const authorTimelineRequestTokenRef = useRef(0)
    const authorTimelineStatsTokenRef = useRef(0)

    // Sync posts ref
    useEffect(() => {
        postsRef.current = posts
    }, [posts])
    useEffect(() => {
        overviewStatsRef.current = overviewStats
    }, [overviewStats])
    useEffect(() => {
        overviewStatsStatusRef.current = overviewStatsStatus
    }, [overviewStatsStatus])
    useEffect(() => {
        selectedUsernamesRef.current = selectedUsernames
    }, [selectedUsernames])
    useEffect(() => {
        searchKeywordRef.current = searchKeyword
    }, [searchKeyword])
    useEffect(() => {
        jumpTargetDateRef.current = jumpTargetDate
    }, [jumpTargetDate])
    useEffect(() => {
        authorTimelinePostsRef.current = authorTimelinePosts
    }, [authorTimelinePosts])
    // 在 DOM 更新后、浏览器绘制前同步调整滚动位置，防止向上加载时页面跳动
    useLayoutEffect(() => {
        const snapshot = scrollAdjustmentRef.current;
        if (snapshot && postsContainerRef.current) {
            const container = postsContainerRef.current;
            const addedHeight = container.scrollHeight - snapshot.scrollHeight;
            if (addedHeight > 0) {
                container.scrollTop = snapshot.scrollTop + addedHeight;
            }
            scrollAdjustmentRef.current = null;
        }
    }, [posts])

    const formatDateOnly = (timestamp: number | null): string => {
        if (!timestamp || timestamp <= 0) return '--'
        const date = new Date(timestamp * 1000)
        if (Number.isNaN(date.getTime())) return '--'
        const year = date.getFullYear()
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
    }

    const decodeHtmlEntities = (text: string): string => {
        if (!text) return ''
        return text
            .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
            .replace(/&amp;/gi, '&')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'")
            .trim()
    }

    const normalizePostCount = useCallback((value: unknown): number => {
        const numeric = Number(value)
        if (!Number.isFinite(numeric)) return 0
        return Math.max(0, Math.floor(numeric))
    }, [])

    const compareContactsForRanking = useCallback((a: Contact, b: Contact): number => {
        const aReady = a.postCountStatus === 'ready'
        const bReady = b.postCountStatus === 'ready'
        if (aReady && bReady) {
            const countDiff = normalizePostCount(b.postCount) - normalizePostCount(a.postCount)
            if (countDiff !== 0) return countDiff
        } else if (aReady !== bReady) {
            return aReady ? -1 : 1
        }

        const tsDiff = Number(b.lastSessionTimestamp || 0) - Number(a.lastSessionTimestamp || 0)
        if (tsDiff !== 0) return tsDiff
        return (a.displayName || a.username).localeCompare((b.displayName || b.username), 'zh-Hans-CN')
    }, [normalizePostCount])

    const sortContactsForRanking = useCallback((input: Contact[]): Contact[] => {
        return [...input].sort(compareContactsForRanking)
    }, [compareContactsForRanking])

    const isDefaultViewNow = useCallback(() => {
        return selectedUsernamesRef.current.length === 0 && !searchKeywordRef.current.trim() && !jumpTargetDateRef.current
    }, [])

    const ensureSnsCacheScopeKey = useCallback(async () => {
        if (cacheScopeKeyRef.current) return cacheScopeKeyRef.current
        const wxid = (await configService.getMyWxid())?.trim() || SNS_PAGE_CACHE_SCOPE_FALLBACK
        const scopeKey = `sns_page:${wxid}`
        cacheScopeKeyRef.current = scopeKey
        return scopeKey
    }, [])

    const persistSnsPageCache = useCallback(async (patch?: { posts?: SnsPost[]; overviewStats?: SnsOverviewStats }) => {
        if (!isDefaultViewNow()) return
        try {
            const scopeKey = await ensureSnsCacheScopeKey()
            if (!scopeKey) return
            const existingCache = await configService.getSnsPageCache(scopeKey)
            let postsToStore = patch?.posts ?? postsRef.current
            if (!patch?.posts && postsToStore.length === 0) {
                if (existingCache && Array.isArray(existingCache.posts) && existingCache.posts.length > 0) {
                    postsToStore = existingCache.posts as SnsPost[]
                }
            }
            const overviewToStore = patch?.overviewStats
                ?? (overviewStatsStatusRef.current === 'ready'
                    ? overviewStatsRef.current
                    : existingCache?.overviewStats ?? overviewStatsRef.current)
            await configService.setSnsPageCache(scopeKey, {
                overviewStats: overviewToStore,
                posts: postsToStore.slice(0, SNS_PAGE_CACHE_POST_LIMIT)
            })
        } catch (error) {
            console.error('Failed to persist SNS page cache:', error)
        }
    }, [ensureSnsCacheScopeKey, isDefaultViewNow])

    const hydrateSnsPageCache = useCallback(async () => {
        try {
            const scopeKey = await ensureSnsCacheScopeKey()
            const cached = await configService.getSnsPageCache(scopeKey)
            if (!cached) return
            if (Date.now() - cached.updatedAt > SNS_PAGE_CACHE_TTL_MS) return

            const cachedOverview = cached.overviewStats
            if (cachedOverview) {
                const cachedTotalPosts = Math.max(0, Number(cachedOverview.totalPosts || 0))
                const cachedTotalFriends = Math.max(0, Number(cachedOverview.totalFriends || 0))
                const hasCachedPosts = Array.isArray(cached.posts) && cached.posts.length > 0
                const hasOverviewData = cachedTotalPosts > 0 || cachedTotalFriends > 0
                setOverviewStats({
                    totalPosts: cachedTotalPosts,
                    totalFriends: cachedTotalFriends,
                    myPosts: typeof cachedOverview.myPosts === 'number' && Number.isFinite(cachedOverview.myPosts) && cachedOverview.myPosts >= 0
                        ? Math.floor(cachedOverview.myPosts)
                        : null,
                    earliestTime: cachedOverview.earliestTime ?? null,
                    latestTime: cachedOverview.latestTime ?? null
                })
                // 只有明确有统计值（或确实无帖子）时才把缓存视为 ready，避免历史异常 0 卡住显示。
                setOverviewStatsStatus(hasOverviewData || !hasCachedPosts ? 'ready' : 'loading')
            }

            if (Array.isArray(cached.posts) && cached.posts.length > 0) {
                const cachedPosts = cached.posts
                    .filter((raw): raw is SnsPost => {
                        if (!raw || typeof raw !== 'object') return false
                        const row = raw as Record<string, unknown>
                        return typeof row.id === 'string' && typeof row.createTime === 'number'
                    })
                    .slice(0, SNS_PAGE_CACHE_POST_LIMIT)
                    .sort((a, b) => b.createTime - a.createTime)

                if (cachedPosts.length > 0) {
                    setPosts(cachedPosts)
                    setHasMore(true)
                    setHasNewer(false)
                }
            }
        } catch (error) {
            console.error('Failed to hydrate SNS page cache:', error)
        }
    }, [ensureSnsCacheScopeKey])

    const loadOverviewStats = useCallback(async () => {
        setOverviewStatsStatus('loading')
        try {
            const statsResult = await window.electronAPI.sns.getExportStats()
            if (!statsResult.success || !statsResult.data) {
                throw new Error(statsResult.error || '获取朋友圈统计失败')
            }

            const totalPosts = Math.max(0, Number(statsResult.data.totalPosts || 0))
            const totalFriends = Math.max(0, Number(statsResult.data.totalFriends || 0))
            const myPosts = (typeof statsResult.data.myPosts === 'number' && Number.isFinite(statsResult.data.myPosts) && statsResult.data.myPosts >= 0)
                ? Math.floor(statsResult.data.myPosts)
                : null
            let earliestTime: number | null = null
            let latestTime: number | null = null

            if (totalPosts > 0) {
                const [latestResult, earliestResult] = await Promise.all([
                    window.electronAPI.sns.getTimeline(1, 0),
                    window.electronAPI.sns.getTimeline(1, Math.max(totalPosts - 1, 0))
                ])
                const latestTs = Number(latestResult.timeline?.[0]?.createTime || 0)
                const earliestTs = Number(earliestResult.timeline?.[0]?.createTime || 0)

                if (latestResult.success && Number.isFinite(latestTs) && latestTs > 0) {
                    latestTime = Math.floor(latestTs)
                }
                if (earliestResult.success && Number.isFinite(earliestTs) && earliestTs > 0) {
                    earliestTime = Math.floor(earliestTs)
                }
            }

            const nextOverviewStats = {
                totalPosts,
                totalFriends,
                myPosts,
                earliestTime,
                latestTime
            }
            setOverviewStats(nextOverviewStats)
            setOverviewStatsStatus('ready')
            void persistSnsPageCache({ overviewStats: nextOverviewStats })
        } catch (error) {
            console.error('Failed to load SNS overview stats:', error)
            setOverviewStatsStatus('error')
        }
    }, [persistSnsPageCache])

    const renderOverviewStats = () => {
        if (overviewStatsStatus === 'error') {
            return (
                <button type="button" className="feed-stats-retry" onClick={() => { void loadOverviewStats() }}>
                    统计失败，点击重试
                </button>
            )
        }
        if (overviewStatsStatus === 'loading') {
            return '统计中...'
        }
        return `共 ${overviewStats.totalPosts} 条 ｜ ${formatDateOnly(overviewStats.earliestTime)} ~ ${formatDateOnly(overviewStats.latestTime)} ｜ ${overviewStats.totalFriends} 位好友`
    }

    const loadPosts = useCallback(async (options: { reset?: boolean, direction?: 'older' | 'newer' } = {}) => {
        const { reset = false, direction = 'older' } = options
        if (loadingRef.current) return

        loadingRef.current = true
        if (direction === 'newer') setLoadingNewer(true)
        else setLoading(true)

        try {
            const limit = 20
            let startTs: number | undefined = undefined
            let endTs: number | undefined = undefined

            if (reset) {
                // If jumping to date, set endTs to end of that day
                if (jumpTargetDate) {
                    endTs = Math.floor(jumpTargetDate.getTime() / 1000) + 86399
                }
            } else if (direction === 'newer') {
                const currentPosts = postsRef.current
                if (currentPosts.length > 0) {
                    const topTs = currentPosts[0].createTime

                    const result = await window.electronAPI.sns.getTimeline(
                        limit,
                        0,
                        selectedUsernames,
                        searchKeyword,
                        topTs + 1,
                        undefined
                    );

                    if (result.success && result.timeline && result.timeline.length > 0) {
                        if (postsContainerRef.current) {
                            scrollAdjustmentRef.current = {
                                scrollHeight: postsContainerRef.current.scrollHeight,
                                scrollTop: postsContainerRef.current.scrollTop
                            };
                        }

                        const existingIds = new Set(currentPosts.map((p: SnsPost) => p.id));
                        const uniqueNewer = result.timeline.filter((p: SnsPost) => !existingIds.has(p.id));

                        if (uniqueNewer.length > 0) {
                            const merged = [...uniqueNewer, ...currentPosts].sort((a, b) => b.createTime - a.createTime)
                            setPosts(merged);
                            void persistSnsPageCache({ posts: merged })
                        }
                        setHasNewer(result.timeline.length >= limit);
                    } else {
                        setHasNewer(false);
                    }
                }
                setLoadingNewer(false);
                loadingRef.current = false;
                return;
            } else {
                // Loading older
                const currentPosts = postsRef.current
                if (currentPosts.length > 0) {
                    endTs = currentPosts[currentPosts.length - 1].createTime - 1
                }
            }

            const result = await window.electronAPI.sns.getTimeline(
                limit,
                0,
                selectedUsernames,
                searchKeyword,
                startTs, // default undefined
                endTs
            )

            if (result.success && result.timeline) {
                if (reset) {
                    setPosts(result.timeline)
                    void persistSnsPageCache({ posts: result.timeline })
                    setHasMore(result.timeline.length >= limit)

                    // Check for newer items above topTs
                    const topTs = result.timeline[0]?.createTime || 0;
                    if (topTs > 0) {
                        const checkResult = await window.electronAPI.sns.getTimeline(1, 0, selectedUsernames, searchKeyword, topTs + 1, undefined);
                        setHasNewer(!!(checkResult.success && checkResult.timeline && checkResult.timeline.length > 0));
                    } else {
                        setHasNewer(false);
                    }

                    if (postsContainerRef.current) {
                        postsContainerRef.current.scrollTop = 0
                    }
                } else {
                    if (result.timeline.length > 0) {
                        const merged = [...postsRef.current, ...result.timeline!].sort((a, b) => b.createTime - a.createTime)
                        setPosts(merged)
                        void persistSnsPageCache({ posts: merged })
                    }
                    if (result.timeline.length < limit) {
                        setHasMore(false)
                    }
                }
            }
        } catch (error) {
            console.error('Failed to load SNS timeline:', error)
        } finally {
            setLoading(false)
            setLoadingNewer(false)
            loadingRef.current = false
        }
    }, [jumpTargetDate, persistSnsPageCache, searchKeyword, selectedUsernames])

    const stopContactsCountHydration = useCallback((resetProgress = false) => {
        contactsCountHydrationTokenRef.current += 1
        if (contactsCountBatchTimerRef.current) {
            window.clearTimeout(contactsCountBatchTimerRef.current)
            contactsCountBatchTimerRef.current = null
        }
        if (resetProgress) {
            setContactsCountProgress({
                resolved: 0,
                total: 0,
                running: false
            })
        } else {
            setContactsCountProgress((prev) => ({ ...prev, running: false }))
        }
    }, [])

    const hydrateContactPostCounts = useCallback(async (usernames: string[]) => {
        const targets = usernames
            .map((username) => String(username || '').trim())
            .filter(Boolean)
        stopContactsCountHydration(true)
        if (targets.length === 0) return

        const runToken = ++contactsCountHydrationTokenRef.current
        const totalTargets = targets.length
        const targetSet = new Set(targets)

        setContacts((prev) => {
            let changed = false
            const next = prev.map((contact) => {
                if (!targetSet.has(contact.username)) return contact
                if (contact.postCountStatus === 'loading' && typeof contact.postCount !== 'number') return contact
                changed = true
                return {
                    ...contact,
                    postCount: undefined,
                    postCountStatus: 'loading' as ContactPostCountStatus
                }
            })
            return changed ? sortContactsForRanking(next) : prev
        })
        setContactsCountProgress({
            resolved: 0,
            total: totalTargets,
            running: true
        })

        let normalizedCounts: Record<string, number> = {}
        try {
            const result = await window.electronAPI.sns.getUserPostCounts()
            if (runToken !== contactsCountHydrationTokenRef.current) return
            if (result.success && result.counts) {
                normalizedCounts = Object.fromEntries(
                    Object.entries(result.counts).map(([username, value]) => [username, normalizePostCount(value)])
                )
            }
        } catch (error) {
            console.error('Failed to load contact post counts:', error)
        }

        let resolved = 0
        let cursor = 0
        const applyBatch = () => {
            if (runToken !== contactsCountHydrationTokenRef.current) return

            const batch = targets.slice(cursor, cursor + CONTACT_COUNT_BATCH_SIZE)
            if (batch.length === 0) {
                setContactsCountProgress({
                    resolved: totalTargets,
                    total: totalTargets,
                    running: false
                })
                contactsCountBatchTimerRef.current = null
                return
            }

            const batchSet = new Set(batch)
            setContacts((prev) => {
                let changed = false
                const next = prev.map((contact) => {
                    if (!batchSet.has(contact.username)) return contact
                    const nextCount = normalizePostCount(normalizedCounts[contact.username])
                    if (contact.postCountStatus === 'ready' && contact.postCount === nextCount) return contact
                    changed = true
                    return {
                        ...contact,
                        postCount: nextCount,
                        postCountStatus: 'ready' as ContactPostCountStatus
                    }
                })
                return changed ? sortContactsForRanking(next) : prev
            })

            resolved += batch.length
            cursor += batch.length
            setContactsCountProgress({
                resolved,
                total: totalTargets,
                running: resolved < totalTargets
            })

            if (cursor < totalTargets) {
                contactsCountBatchTimerRef.current = window.setTimeout(applyBatch, CONTACT_COUNT_SORT_DEBOUNCE_MS)
            } else {
                contactsCountBatchTimerRef.current = null
            }
        }

        applyBatch()
    }, [normalizePostCount, sortContactsForRanking, stopContactsCountHydration])

    // Load Contacts（先按最近会话显示联系人，再异步统计朋友圈条数并增量排序）
    const loadContacts = useCallback(async () => {
        const requestToken = ++contactsLoadTokenRef.current
        stopContactsCountHydration(true)
        setContactsLoading(true)
        try {
            const [contactsResult, sessionsResult] = await Promise.all([
                window.electronAPI.chat.getContacts(),
                window.electronAPI.chat.getSessions()
            ])
            const contactMap = new Map<string, Contact>()
            const sessionTimestampMap = new Map<string, number>()

            if (sessionsResult.success && Array.isArray(sessionsResult.sessions)) {
                for (const session of sessionsResult.sessions) {
                    const username = String(session?.username || '').trim()
                    if (!username) continue
                    const ts = Math.max(
                        Number(session?.sortTimestamp || 0),
                        Number(session?.lastTimestamp || 0)
                    )
                    const prevTs = Number(sessionTimestampMap.get(username) || 0)
                    if (ts > prevTs) {
                        sessionTimestampMap.set(username, ts)
                    }
                }
            }

            if (contactsResult.success && contactsResult.contacts) {
                for (const c of contactsResult.contacts) {
                    if (c.type === 'friend' || c.type === 'former_friend') {
                        contactMap.set(c.username, {
                            username: c.username,
                            displayName: c.displayName,
                            avatarUrl: c.avatarUrl,
                            type: c.type === 'former_friend' ? 'former_friend' : 'friend',
                            lastSessionTimestamp: Number(sessionTimestampMap.get(c.username) || 0),
                            postCount: undefined,
                            postCountStatus: 'idle'
                        })
                    }
                }
            }

            let contactsList = sortContactsForRanking(Array.from(contactMap.values()))
            if (requestToken !== contactsLoadTokenRef.current) return
            setContacts(contactsList)
            void hydrateContactPostCounts(contactsList.map(contact => contact.username))

            const allUsernames = contactsList.map(c => c.username)

            // 用 enrichSessionsContactInfo 统一补充头像和显示名
            if (allUsernames.length > 0) {
                const enriched = await window.electronAPI.chat.enrichSessionsContactInfo(allUsernames)
                if (enriched.success && enriched.contacts) {
                    contactsList = contactsList.map((contact) => {
                        const extra = enriched.contacts?.[contact.username]
                        if (!extra) return contact
                        return {
                            ...contact,
                            displayName: extra.displayName || contact.displayName,
                            avatarUrl: extra.avatarUrl || contact.avatarUrl
                        }
                    })
                    if (requestToken !== contactsLoadTokenRef.current) return
                    setContacts((prev) => {
                        const prevMap = new Map(prev.map((contact) => [contact.username, contact]))
                        const merged = contactsList.map((contact) => {
                            const previous = prevMap.get(contact.username)
                            return {
                                ...contact,
                                lastSessionTimestamp: previous?.lastSessionTimestamp ?? contact.lastSessionTimestamp,
                                postCount: previous?.postCount,
                                postCountStatus: previous?.postCountStatus ?? contact.postCountStatus
                            }
                        })
                        return sortContactsForRanking(merged)
                    })
                }
            }
        } catch (error) {
            if (requestToken !== contactsLoadTokenRef.current) return
            console.error('Failed to load contacts:', error)
            stopContactsCountHydration(true)
        } finally {
            if (requestToken === contactsLoadTokenRef.current) {
                setContactsLoading(false)
            }
        }
    }, [hydrateContactPostCounts, sortContactsForRanking, stopContactsCountHydration])

    const closeAuthorTimeline = useCallback(() => {
        authorTimelineRequestTokenRef.current += 1
        authorTimelineStatsTokenRef.current += 1
        authorTimelineLoadingRef.current = false
        setAuthorTimelineTarget(null)
        setAuthorTimelinePosts([])
        setAuthorTimelineLoading(false)
        setAuthorTimelineLoadingMore(false)
        setAuthorTimelineHasMore(false)
        setAuthorTimelineTotalPosts(null)
        setAuthorTimelineStatsLoading(false)
    }, [])

    const loadAuthorTimelineTotalPosts = useCallback(async (target: AuthorTimelineTarget) => {
        const requestToken = ++authorTimelineStatsTokenRef.current
        setAuthorTimelineStatsLoading(true)
        setAuthorTimelineTotalPosts(null)

        try {
            const result = await window.electronAPI.sns.getUserPostCounts()
            if (requestToken !== authorTimelineStatsTokenRef.current) return

            if (result.success && result.counts) {
                const totalPosts = result.counts[target.username] ?? 0
                setAuthorTimelineTotalPosts(Math.max(0, Number(totalPosts || 0)))
            } else {
                setAuthorTimelineTotalPosts(null)
            }
        } catch (error) {
            console.error('Failed to load author timeline total posts:', error)
            if (requestToken === authorTimelineStatsTokenRef.current) {
                setAuthorTimelineTotalPosts(null)
            }
        } finally {
            if (requestToken === authorTimelineStatsTokenRef.current) {
                setAuthorTimelineStatsLoading(false)
            }
        }
    }, [])

    const loadAuthorTimelinePosts = useCallback(async (target: AuthorTimelineTarget, options: { reset?: boolean } = {}) => {
        const { reset = false } = options
        if (authorTimelineLoadingRef.current) return

        authorTimelineLoadingRef.current = true
        if (reset) {
            setAuthorTimelineLoading(true)
            setAuthorTimelineLoadingMore(false)
            setAuthorTimelineHasMore(false)
        } else {
            setAuthorTimelineLoadingMore(true)
        }

        const requestToken = ++authorTimelineRequestTokenRef.current

        try {
            const limit = 20
            let endTs: number | undefined = undefined

            if (!reset && authorTimelinePostsRef.current.length > 0) {
                endTs = authorTimelinePostsRef.current[authorTimelinePostsRef.current.length - 1].createTime - 1
            }

            const result = await window.electronAPI.sns.getTimeline(
                limit,
                0,
                [target.username],
                '',
                undefined,
                endTs
            )

            if (requestToken !== authorTimelineRequestTokenRef.current) return
            if (!result.success || !result.timeline) {
                if (reset) {
                    setAuthorTimelinePosts([])
                    setAuthorTimelineHasMore(false)
                }
                return
            }

            if (reset) {
                const sorted = [...result.timeline].sort((a, b) => b.createTime - a.createTime)
                setAuthorTimelinePosts(sorted)
                setAuthorTimelineHasMore(result.timeline.length >= limit)
                return
            }

            const existingIds = new Set(authorTimelinePostsRef.current.map((p) => p.id))
            const uniqueOlder = result.timeline.filter((p) => !existingIds.has(p.id))
            if (uniqueOlder.length > 0) {
                const merged = [...authorTimelinePostsRef.current, ...uniqueOlder].sort((a, b) => b.createTime - a.createTime)
                setAuthorTimelinePosts(merged)
            }
            if (result.timeline.length < limit) {
                setAuthorTimelineHasMore(false)
            }
        } catch (error) {
            console.error('Failed to load author timeline:', error)
            if (requestToken === authorTimelineRequestTokenRef.current && reset) {
                setAuthorTimelinePosts([])
                setAuthorTimelineHasMore(false)
            }
        } finally {
            if (requestToken === authorTimelineRequestTokenRef.current) {
                authorTimelineLoadingRef.current = false
                setAuthorTimelineLoading(false)
                setAuthorTimelineLoadingMore(false)
            }
        }
    }, [])

    const openAuthorTimeline = useCallback((post: SnsPost) => {
        authorTimelineRequestTokenRef.current += 1
        authorTimelineLoadingRef.current = false
        const target = {
            username: post.username,
            nickname: post.nickname,
            avatarUrl: post.avatarUrl
        }
        setAuthorTimelineTarget(target)
        setAuthorTimelinePosts([])
        setAuthorTimelineHasMore(false)
        setAuthorTimelineTotalPosts(null)
        void loadAuthorTimelinePosts(target, { reset: true })
        void loadAuthorTimelineTotalPosts(target)
    }, [loadAuthorTimelinePosts, loadAuthorTimelineTotalPosts])

    const loadMoreAuthorTimeline = useCallback(() => {
        if (!authorTimelineTarget || authorTimelineLoading || authorTimelineLoadingMore || !authorTimelineHasMore) return
        void loadAuthorTimelinePosts(authorTimelineTarget, { reset: false })
    }, [authorTimelineHasMore, authorTimelineLoading, authorTimelineLoadingMore, authorTimelineTarget, loadAuthorTimelinePosts])

    const handlePostDelete = useCallback((postId: string, username: string) => {
        setPosts(prev => {
            const next = prev.filter(p => p.id !== postId)
            void persistSnsPageCache({ posts: next })
            return next
        })
        setAuthorTimelinePosts(prev => prev.filter(p => p.id !== postId))
        if (authorTimelineTarget && authorTimelineTarget.username === username) {
            setAuthorTimelineTotalPosts(prev => prev === null ? null : Math.max(0, prev - 1))
        }
        void loadOverviewStats()
    }, [authorTimelineTarget, loadOverviewStats, persistSnsPageCache])

    // Initial Load & Listeners
    useEffect(() => {
        void hydrateSnsPageCache()
        loadContacts()
        loadOverviewStats()
    }, [hydrateSnsPageCache, loadContacts, loadOverviewStats])

    useEffect(() => {
        return () => {
            contactsCountHydrationTokenRef.current += 1
            if (contactsCountBatchTimerRef.current) {
                window.clearTimeout(contactsCountBatchTimerRef.current)
                contactsCountBatchTimerRef.current = null
            }
        }
    }, [])

    useEffect(() => {
        const handleChange = () => {
            cacheScopeKeyRef.current = ''
            // wxid changed, reset everything
            stopContactsCountHydration(true)
            setContacts([])
            setPosts([]); setHasMore(true); setHasNewer(false);
            setSelectedUsernames([]); setSearchKeyword(''); setJumpTargetDate(undefined);
            void hydrateSnsPageCache()
            loadContacts();
            loadOverviewStats();
            loadPosts({ reset: true });
        }
        window.addEventListener('wxid-changed', handleChange as EventListener)
        return () => window.removeEventListener('wxid-changed', handleChange as EventListener)
    }, [hydrateSnsPageCache, loadContacts, loadOverviewStats, loadPosts, stopContactsCountHydration])

    useEffect(() => {
        const timer = setTimeout(() => {
            loadPosts({ reset: true })
        }, 500)
        return () => clearTimeout(timer)
    }, [selectedUsernames, searchKeyword, jumpTargetDate, loadPosts])

    useEffect(() => {
        if (!authorTimelineTarget) return
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                closeAuthorTimeline()
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [authorTimelineTarget, closeAuthorTimeline])

    useEffect(() => {
        if (authorTimelineTotalPosts === null) return
        if (authorTimelinePosts.length >= authorTimelineTotalPosts) {
            setAuthorTimelineHasMore(false)
        }
    }, [authorTimelinePosts.length, authorTimelineTotalPosts])

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const { scrollTop, clientHeight, scrollHeight } = e.currentTarget
        if (scrollHeight - scrollTop - clientHeight < 400 && hasMore && !loading && !loadingNewer) {
            loadPosts({ direction: 'older' })
        }
        if (scrollTop < 10 && hasNewer && !loading && !loadingNewer) {
            loadPosts({ direction: 'newer' })
        }
    }

    const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
        const container = postsContainerRef.current
        if (!container) return
        if (e.deltaY < -20 && container.scrollTop <= 0 && hasNewer && !loading && !loadingNewer) {
            loadPosts({ direction: 'newer' })
        }
    }

    const handleAuthorTimelineScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const { scrollTop, clientHeight, scrollHeight } = e.currentTarget
        if (scrollHeight - scrollTop - clientHeight < 260) {
            loadMoreAuthorTimeline()
        }
    }

    const renderAuthorTimelineStats = () => {
        const loadedCount = authorTimelinePosts.length
        const loadPart = authorTimelineStatsLoading
            ? `已加载 ${loadedCount} / 总数统计中...`
            : authorTimelineTotalPosts === null
                ? `已加载 ${loadedCount} 条`
                : `已加载 ${loadedCount} / 共 ${authorTimelineTotalPosts} 条`

        if (authorTimelineLoading && loadedCount === 0) return `${loadPart} ｜ 加载中...`
        if (loadedCount === 0) return loadPart

        const latest = authorTimelinePosts[0]?.createTime ?? null
        const earliest = authorTimelinePosts[authorTimelinePosts.length - 1]?.createTime ?? null
        return `${loadPart} ｜ ${formatDateOnly(earliest)} ~ ${formatDateOnly(latest)}`
    }

    return (
        <div className="sns-page-layout">
            <div className="sns-main-viewport">
                <div className="sns-feed-container">
                    <div className="feed-header">
                        <div className="feed-header-main">
                            <h2>朋友圈</h2>
                            <div className={`feed-stats-line ${overviewStatsStatus}`}>
                                {renderOverviewStats()}
                            </div>
                        </div>
                        <div className="header-actions">
                            <button
                                onClick={async () => {
                                    setTriggerMessage(null)
                                    setShowTriggerDialog(true)
                                    setTriggerLoading(true)
                                    try {
                                        const r = await window.electronAPI.sns.checkBlockDeleteTrigger()
                                        setTriggerInstalled(r.success ? (r.installed ?? false) : false)
                                    } catch {
                                        setTriggerInstalled(false)
                                    } finally {
                                        setTriggerLoading(false)
                                    }
                                }}
                                className="icon-btn"
                                title="朋友圈保护插件"
                            >
                                <Shield size={20} />
                            </button>
                            <button
                                onClick={() => {
                                    setExportResult(null)
                                    setExportProgress(null)
                                    setExportDateRange({ start: '', end: '' })
                                    setShowExportDialog(true)
                                }}
                                className="icon-btn export-btn"
                                title="导出朋友圈"
                            >
                                <Download size={20} />
                            </button>
                            <button
                                onClick={() => {
                                    setRefreshSpin(true)
                                    loadPosts({ reset: true })
                                    loadOverviewStats()
                                    setTimeout(() => setRefreshSpin(false), 800)
                                }}
                                disabled={loading || loadingNewer}
                                className="icon-btn refresh-btn"
                                title="从头刷新"
                            >
                                <RefreshCw size={20} className={(loading || loadingNewer || refreshSpin) ? 'spinning' : ''} />
                            </button>
                        </div>
                    </div>

                    <div className="sns-posts-scroll" onScroll={handleScroll} onWheel={handleWheel} ref={postsContainerRef}>
                        {loadingNewer && (
                            <div className="status-indicator loading-newer">
                                <RefreshCw size={16} className="spinning" />
                                <span>正在检查更新的动态...</span>
                            </div>
                        )}

                        {!loadingNewer && hasNewer && (
                            <div className="status-indicator newer-hint" onClick={() => loadPosts({ direction: 'newer' })}>
                                有新动态，点击查看
                            </div>
                        )}

                        <div className="posts-list">
                            {posts.map(post => (
                                <SnsPostItem
                                    key={post.id}
                                    post={{ ...post, isProtected: triggerInstalled === true }}
                                    onPreview={(src, isVideo, liveVideoPath) => {
                                        if (isVideo) {
                                            void window.electronAPI.window.openVideoPlayerWindow(src)
                                        } else {
                                            void window.electronAPI.window.openImageViewerWindow(src, liveVideoPath || undefined)
                                        }
                                    }}
                                    onDebug={(p) => setDebugPost(p)}
                                    onDelete={handlePostDelete}
                                    onOpenAuthorPosts={openAuthorTimeline}
                                />
                            ))}
                        </div>

                        {loading && posts.length === 0 && (
                            <div className="initial-loading">
                                <div className="loading-pulse">
                                    <div className="pulse-circle"></div>
                                    <span>正在加载朋友圈...</span>
                                </div>
                            </div>
                        )}

                        {loading && posts.length > 0 && (
                            <div className="status-indicator loading-more">
                                <RefreshCw size={16} className="spinning" />
                                <span>正在加载更多...</span>
                            </div>
                        )}

                        {!hasMore && posts.length > 0 && (
                            <div className="status-indicator no-more">{
                                selectedUsernames.length === 1 &&
                                contacts.find(c => c.username === selectedUsernames[0])?.type === 'former_friend'
                                    ? '在时间的长河里刻舟求剑'
                                    : '或许过往已无可溯洄，但好在还有可以与你相遇的明天'
                            }</div>
                        )}

                        {!loading && posts.length === 0 && (
                            <div className="no-results">
                                <div className="no-results-icon"><Search size={48} /></div>
                                <p>未找到相关动态</p>
                                {(selectedUsernames.length > 0 || searchKeyword || jumpTargetDate) && (
                                    <button onClick={() => {
                                        setSearchKeyword(''); setSelectedUsernames([]); setJumpTargetDate(undefined);
                                    }} className="reset-inline">
                                        重置筛选条件
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <SnsFilterPanel
                searchKeyword={searchKeyword}
                setSearchKeyword={setSearchKeyword}
                jumpTargetDate={jumpTargetDate}
                setJumpTargetDate={setJumpTargetDate}
                onOpenJumpDialog={() => setShowJumpDialog(true)}
                selectedUsernames={selectedUsernames}
                setSelectedUsernames={setSelectedUsernames}
                contacts={contacts}
                contactSearch={contactSearch}
                setContactSearch={setContactSearch}
                loading={contactsLoading}
                contactsCountProgress={contactsCountProgress}
            />

            {/* Dialogs and Overlays */}
            <JumpToDateDialog
                isOpen={showJumpDialog}
                onClose={() => setShowJumpDialog(false)}
                onSelect={(date) => {
                    setJumpTargetDate(date)
                    setShowJumpDialog(false)
                }}
                currentDate={jumpTargetDate || new Date()}
            />

            {authorTimelineTarget && (
                <div className="modal-overlay" onClick={closeAuthorTimeline}>
                    <div className="author-timeline-dialog" onClick={(e) => e.stopPropagation()}>
                        <div className="author-timeline-header">
                            <div className="author-timeline-meta">
                                <Avatar
                                    src={authorTimelineTarget.avatarUrl}
                                    name={authorTimelineTarget.nickname}
                                    size={42}
                                    shape="rounded"
                                />
                                <div className="author-timeline-meta-text">
                                    <h3>{decodeHtmlEntities(authorTimelineTarget.nickname)}</h3>
                                    <div className="author-timeline-username">@{authorTimelineTarget.username}</div>
                                    <div className="author-timeline-stats">{renderAuthorTimelineStats()}</div>
                                </div>
                            </div>
                            <button className="close-btn" onClick={closeAuthorTimeline}>
                                <X size={20} />
                            </button>
                        </div>

                        <div className="author-timeline-body" onScroll={handleAuthorTimelineScroll}>
                            {authorTimelinePosts.length > 0 && (
                                <div className="posts-list author-timeline-posts-list">
                                    {authorTimelinePosts.map(post => (
                                        <SnsPostItem
                                            key={post.id}
                                            post={{ ...post, isProtected: triggerInstalled === true }}
                                            onPreview={(src, isVideo, liveVideoPath) => {
                                                if (isVideo) {
                                                    void window.electronAPI.window.openVideoPlayerWindow(src)
                                                } else {
                                                    void window.electronAPI.window.openImageViewerWindow(src, liveVideoPath || undefined)
                                                }
                                            }}
                                            onDebug={(p) => setDebugPost(p)}
                                            onDelete={handlePostDelete}
                                            onOpenAuthorPosts={openAuthorTimeline}
                                            hideAuthorMeta
                                        />
                                    ))}
                                </div>
                            )}

                            {authorTimelineLoading && (
                                <div className="status-indicator loading-more author-timeline-loading">
                                    <RefreshCw size={16} className="spinning" />
                                    <span>正在加载该用户朋友圈...</span>
                                </div>
                            )}

                            {!authorTimelineLoading && authorTimelinePosts.length === 0 && (
                                <div className="author-timeline-empty">该用户暂无朋友圈</div>
                            )}

                            {!authorTimelineLoading && authorTimelineHasMore && (
                                <button
                                    type="button"
                                    className="author-timeline-load-more"
                                    onClick={loadMoreAuthorTimeline}
                                    disabled={authorTimelineLoadingMore}
                                >
                                    {authorTimelineLoadingMore ? '正在加载...' : '加载更多'}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {debugPost && (
                <div className="modal-overlay" onClick={() => setDebugPost(null)}>
                    <div className="debug-dialog" onClick={(e) => e.stopPropagation()}>
                        <div className="debug-dialog-header">
                            <h3>原始数据</h3>
                            <button className="close-btn" onClick={() => setDebugPost(null)}>
                                <X size={20} />
                            </button>
                        </div>
                        <div className="debug-dialog-body">
                            <pre className="json-code">
                                {JSON.stringify(debugPost, null, 2)}
                            </pre>
                        </div>
                    </div>
                </div>
            )}

            {/* 朋友圈防删除插件对话框 */}
            {showTriggerDialog && (
                <div className="modal-overlay" onClick={() => { setShowTriggerDialog(false); setTriggerMessage(null) }}>
                    <div className="sns-protect-dialog" onClick={(e) => e.stopPropagation()}>
                        <button className="close-btn sns-protect-close" onClick={() => { setShowTriggerDialog(false); setTriggerMessage(null) }}>
                            <X size={18} />
                        </button>

                        {/* 顶部图标区 */}
                        <div className="sns-protect-hero">
                            <div className={`sns-protect-icon-wrap ${triggerInstalled ? 'active' : ''}`}>
                                {triggerLoading
                                    ? <RefreshCw size={28} className="spinning" />
                                    : triggerInstalled
                                        ? <Shield size={28} />
                                        : <ShieldOff size={28} />
                                }
                            </div>
                            <div className="sns-protect-title">朋友圈防删除</div>
                            <div className={`sns-protect-status-badge ${triggerInstalled ? 'on' : 'off'}`}>
                                {triggerLoading ? '检查中…' : triggerInstalled ? '已启用' : '未启用'}
                            </div>
                        </div>

                        {/* 说明 */}
                        <div className="sns-protect-desc">
                            启用后，WeFlow将拦截朋友圈删除操作<br/>已同步的动态不会从本地数据库中消失<br/>新的动态仍可正常同步。
                        </div>

                        {/* 操作反馈 */}
                        {triggerMessage && (
                            <div className={`sns-protect-feedback ${triggerMessage.type}`}>
                                {triggerMessage.type === 'success' ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                                <span>{triggerMessage.text}</span>
                            </div>
                        )}

                        {/* 操作按钮 */}
                        <div className="sns-protect-actions">
                            {!triggerInstalled ? (
                                <button
                                    className="sns-protect-btn primary"
                                    disabled={triggerLoading}
                                    onClick={async () => {
                                        setTriggerLoading(true)
                                        setTriggerMessage(null)
                                        try {
                                            const r = await window.electronAPI.sns.installBlockDeleteTrigger()
                                            if (r.success) {
                                                setTriggerInstalled(true)
                                                setTriggerMessage({ type: 'success', text: r.alreadyInstalled ? '插件已存在，无需重复安装' : '已启用朋友圈防删除保护' })
                                            } else {
                                                setTriggerMessage({ type: 'error', text: r.error || '安装失败' })
                                            }
                                        } catch (e: any) {
                                            setTriggerMessage({ type: 'error', text: e.message || String(e) })
                                        } finally {
                                            setTriggerLoading(false)
                                        }
                                    }}
                                >
                                    <Shield size={15} />
                                    启用保护
                                </button>
                            ) : (
                                <button
                                    className="sns-protect-btn danger"
                                    disabled={triggerLoading}
                                    onClick={async () => {
                                        setTriggerLoading(true)
                                        setTriggerMessage(null)
                                        try {
                                            const r = await window.electronAPI.sns.uninstallBlockDeleteTrigger()
                                            if (r.success) {
                                                setTriggerInstalled(false)
                                                setTriggerMessage({ type: 'success', text: '已关闭朋友圈防删除保护' })
                                            } else {
                                                setTriggerMessage({ type: 'error', text: r.error || '卸载失败' })
                                            }
                                        } catch (e: any) {
                                            setTriggerMessage({ type: 'error', text: e.message || String(e) })
                                        } finally {
                                            setTriggerLoading(false)
                                        }
                                    }}
                                >
                                    <ShieldOff size={15} />
                                    关闭保护
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* 导出对话框 */}
            {showExportDialog && (
                <div className="modal-overlay" onClick={() => !isExporting && setShowExportDialog(false)}>
                    <div className="export-dialog" onClick={(e) => e.stopPropagation()}>
                        <div className="export-dialog-header">
                            <h3>导出朋友圈</h3>
                            <button className="close-btn" onClick={() => !isExporting && setShowExportDialog(false)} disabled={isExporting}>
                                <X size={20} />
                            </button>
                        </div>

                        <div className="export-dialog-body">
                            {/* 筛选条件提示 */}
                            {(selectedUsernames.length > 0 || searchKeyword) && (
                                <div className="export-filter-info">
                                    <span className="filter-badge">筛选导出</span>
                                    {searchKeyword && <span className="filter-tag">关键词: "{searchKeyword}"</span>}
                                    {selectedUsernames.length > 0 && (
                                        <span className="filter-tag">
                                            <Users size={12} />
                                            {selectedUsernames.length} 个联系人
                                            <span className="sync-hint">（同步自侧栏筛选）</span>
                                        </span>
                                    )}
                                </div>
                            )}

                            {!exportResult ? (
                                <>
                                    {/* 格式选择 */}
                                    <div className="export-section">
                                        <label className="export-label">导出格式</label>
                                        <div className="export-format-options">
                                            <button
                                                className={`format-option ${exportFormat === 'html' ? 'active' : ''}`}
                                                onClick={() => setExportFormat('html')}
                                                disabled={isExporting}
                                            >
                                                <FileText size={20} />
                                                <span>HTML</span>
                                                <small>浏览器可直接查看</small>
                                            </button>
                                            <button
                                                className={`format-option ${exportFormat === 'json' ? 'active' : ''}`}
                                                onClick={() => setExportFormat('json')}
                                                disabled={isExporting}
                                            >
                                                <FileJson size={20} />
                                                <span>JSON</span>
                                                <small>结构化数据</small>
                                            </button>
                                            <button
                                                className={`format-option ${exportFormat === 'arkmejson' ? 'active' : ''}`}
                                                onClick={() => setExportFormat('arkmejson')}
                                                disabled={isExporting}
                                            >
                                                <FileJson size={20} />
                                                <span>ArkmeJSON</span>
                                                <small>结构化数据（含互动身份）</small>
                                            </button>
                                        </div>
                                    </div>

                                    {/* 输出路径 */}
                                    <div className="export-section">
                                        <label className="export-label">输出目录</label>
                                        <div className="export-path-row">
                                            <input
                                                type="text"
                                                value={exportFolder}
                                                readOnly
                                                placeholder="点击选择输出目录..."
                                                className="export-path-input"
                                            />
                                            <button
                                                className="export-browse-btn"
                                                onClick={async () => {
                                                    const result = await window.electronAPI.sns.selectExportDir()
                                                    if (!result.canceled && result.filePath) {
                                                        setExportFolder(result.filePath)
                                                    }
                                                }}
                                                disabled={isExporting}
                                            >
                                                <FolderOpen size={16} />
                                            </button>
                                        </div>
                                    </div>

                                    {/* 时间范围 */}
                                    <div className="export-section">
                                        <label className="export-label"><Calendar size={14} /> 时间范围（可选）</label>
                                        <div className="export-date-row">
                                            <div className="date-picker-trigger" onClick={() => {
                                                if (!isExporting) setCalendarPicker(prev => prev?.field === 'start' ? null : { field: 'start', month: exportDateRange.start ? new Date(exportDateRange.start) : new Date() })
                                            }}>
                                                <Calendar size={14} />
                                                <span className={exportDateRange.start ? '' : 'placeholder'}>
                                                    {exportDateRange.start || '开始日期'}
                                                </span>
                                                {exportDateRange.start && (
                                                    <X size={12} className="clear-date" onClick={(e) => { e.stopPropagation(); setExportDateRange(prev => ({ ...prev, start: '' })) }} />
                                                )}
                                            </div>
                                            <span className="date-separator">至</span>
                                            <div className="date-picker-trigger" onClick={() => {
                                                if (!isExporting) setCalendarPicker(prev => prev?.field === 'end' ? null : { field: 'end', month: exportDateRange.end ? new Date(exportDateRange.end) : new Date() })
                                            }}>
                                                <Calendar size={14} />
                                                <span className={exportDateRange.end ? '' : 'placeholder'}>
                                                    {exportDateRange.end || '结束日期'}
                                                </span>
                                                {exportDateRange.end && (
                                                    <X size={12} className="clear-date" onClick={(e) => { e.stopPropagation(); setExportDateRange(prev => ({ ...prev, end: '' })) }} />
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* 媒体导出 */}
                                    <div className="export-section">
                                        <label className="export-label">
                                            <Image size={14} />
                                            媒体文件（可多选）
                                        </label>
                                        <div className="export-media-check-grid">
                                            <label>
                                                <input
                                                    type="checkbox"
                                                    checked={exportImages}
                                                    onChange={(e) => setExportImages(e.target.checked)}
                                                    disabled={isExporting}
                                                />
                                                图片
                                            </label>
                                            <label>
                                                <input
                                                    type="checkbox"
                                                    checked={exportLivePhotos}
                                                    onChange={(e) => setExportLivePhotos(e.target.checked)}
                                                    disabled={isExporting}
                                                />
                                                实况图
                                            </label>
                                            <label>
                                                <input
                                                    type="checkbox"
                                                    checked={exportVideos}
                                                    onChange={(e) => setExportVideos(e.target.checked)}
                                                    disabled={isExporting}
                                                />
                                                视频
                                            </label>
                                        </div>
                                        <p className="export-media-hint">全不勾选时仅导出文本信息，不导出媒体文件</p>
                                    </div>

                                    {/* 同步提示 */}
                                    <div className="export-sync-hint">
                                        <Info size={14} />
                                        <span>将同步主页面的联系人范围筛选及关键词搜索</span>
                                    </div>

                                    {/* 进度条 */}
                                    {isExporting && exportProgress && (
                                        <div className="export-progress">
                                            <div className="export-progress-bar">
                                                <div
                                                    className="export-progress-fill"
                                                    style={{ width: exportProgress.total > 0 ? `${Math.round((exportProgress.current / exportProgress.total) * 100)}%` : '100%' }}
                                                />
                                            </div>
                                            <span className="export-progress-text">{exportProgress.status}</span>
                                        </div>
                                    )}

                                    {/* 操作按钮 */}
                                    <div className="export-actions">
                                        <button
                                            className="export-cancel-btn"
                                            onClick={() => setShowExportDialog(false)}
                                            disabled={isExporting}
                                        >
                                            取消
                                        </button>
                                        <button
                                            className="export-start-btn"
                                            disabled={!exportFolder || isExporting}
                                            onClick={async () => {
                                                setIsExporting(true)
                                                setExportProgress({ current: 0, total: 0, status: '准备导出...' })
                                                setExportResult(null)

                                                // 监听进度
                                                const removeProgress = window.electronAPI.sns.onExportProgress((progress: any) => {
                                                    setExportProgress(progress)
                                                })

                                                try {
                                                    const result = await window.electronAPI.sns.exportTimeline({
                                                        outputDir: exportFolder,
                                                        format: exportFormat,
                                                        usernames: selectedUsernames.length > 0 ? selectedUsernames : undefined,
                                                        keyword: searchKeyword || undefined,
                                                        exportImages,
                                                        exportLivePhotos,
                                                        exportVideos,
                                                        startTime: exportDateRange.start ? Math.floor(new Date(exportDateRange.start).getTime() / 1000) : undefined,
                                                        endTime: exportDateRange.end ? Math.floor(new Date(exportDateRange.end + 'T23:59:59').getTime() / 1000) : undefined
                                                    })
                                                    setExportResult(result)
                                                } catch (e: any) {
                                                    setExportResult({ success: false, error: e.message || String(e) })
                                                } finally {
                                                    setIsExporting(false)
                                                    removeProgress()
                                                }
                                            }}
                                        >
                                            {isExporting ? '导出中...' : '开始导出'}
                                        </button>
                                    </div>
                                </>
                            ) : (
                                /* 导出结果 */
                                <div className="export-result">
                                    {exportResult.success ? (
                                        <>
                                            <div className="export-result-icon success">
                                                <CheckCircle size={48} />
                                            </div>
                                            <h4>导出成功</h4>
                                            <p>共导出 {exportResult.postCount} 条动态{exportResult.mediaCount ? `，${exportResult.mediaCount} 个媒体文件` : ''}</p>
                                            <div className="export-result-actions">
                                                <button
                                                    className="export-open-btn"
                                                    onClick={() => {
                                                        if (exportFolder) {
                                                            window.electronAPI.shell.openExternal(`file://${exportFolder}`)
                                                        }
                                                    }}
                                                >
                                                    <FolderOpen size={16} />
                                                    打开目录
                                                </button>
                                                <button
                                                    className="export-done-btn"
                                                    onClick={() => setShowExportDialog(false)}
                                                >
                                                    完成
                                                </button>
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            <div className="export-result-icon error">
                                                <AlertCircle size={48} />
                                            </div>
                                            <h4>导出失败</h4>
                                            <p className="error-text">{exportResult.error}</p>
                                            <button
                                                className="export-done-btn"
                                                onClick={() => setExportResult(null)}
                                            >
                                                重试
                                            </button>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* 日期选择弹窗 */}
            {calendarPicker && (
                <div className="calendar-overlay" onClick={() => { setCalendarPicker(null); setShowYearMonthPicker(false) }}>
                    <div className="calendar-modal" onClick={e => e.stopPropagation()}>
                        <div className="calendar-header">
                            <div className="title-area">
                                <Calendar size={18} />
                                <h3>选择{calendarPicker.field === 'start' ? '开始' : '结束'}日期</h3>
                            </div>
                            <button className="close-btn" onClick={() => { setCalendarPicker(null); setShowYearMonthPicker(false) }}>
                                <X size={18} />
                            </button>
                        </div>
                        <div className="calendar-view">
                            <div className="calendar-nav">
                                <button className="nav-btn" onClick={() => setCalendarPicker(prev => prev ? { ...prev, month: new Date(prev.month.getFullYear(), prev.month.getMonth() - 1, 1) } : null)}>
                                    <ChevronLeft size={18} />
                                </button>
                                <span className="current-month clickable" onClick={() => setShowYearMonthPicker(!showYearMonthPicker)}>
                                    {calendarPicker.month.getFullYear()}年{calendarPicker.month.getMonth() + 1}月
                                </span>
                                <button className="nav-btn" onClick={() => setCalendarPicker(prev => prev ? { ...prev, month: new Date(prev.month.getFullYear(), prev.month.getMonth() + 1, 1) } : null)}>
                                    <ChevronRight size={18} />
                                </button>
                            </div>
                            {showYearMonthPicker ? (
                                <div className="year-month-picker">
                                    <div className="year-selector">
                                        <button className="nav-btn" onClick={() => setCalendarPicker(prev => prev ? { ...prev, month: new Date(prev.month.getFullYear() - 1, prev.month.getMonth(), 1) } : null)}>
                                            <ChevronLeft size={16} />
                                        </button>
                                        <span className="year-label">{calendarPicker.month.getFullYear()}年</span>
                                        <button className="nav-btn" onClick={() => setCalendarPicker(prev => prev ? { ...prev, month: new Date(prev.month.getFullYear() + 1, prev.month.getMonth(), 1) } : null)}>
                                            <ChevronRight size={16} />
                                        </button>
                                    </div>
                                    <div className="month-grid">
                                        {['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'].map((name, i) => (
                                            <button
                                                key={i}
                                                className={`month-btn ${i === calendarPicker.month.getMonth() ? 'active' : ''}`}
                                                onClick={() => {
                                                    setCalendarPicker(prev => prev ? { ...prev, month: new Date(prev.month.getFullYear(), i, 1) } : null)
                                                    setShowYearMonthPicker(false)
                                                }}
                                            >{name}</button>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                              <>
                            <div className="calendar-weekdays">
                                {['日', '一', '二', '三', '四', '五', '六'].map(d => <div key={d} className="weekday">{d}</div>)}
                            </div>
                            <div className="calendar-days">
                                {(() => {
                                    const y = calendarPicker.month.getFullYear()
                                    const m = calendarPicker.month.getMonth()
                                    const firstDay = new Date(y, m, 1).getDay()
                                    const daysInMonth = new Date(y, m + 1, 0).getDate()
                                    const cells: (number | null)[] = []
                                    for (let i = 0; i < firstDay; i++) cells.push(null)
                                    for (let i = 1; i <= daysInMonth; i++) cells.push(i)
                                    const today = new Date()
                                    return cells.map((day, i) => {
                                        if (day === null) return <div key={i} className="day-cell empty" />
                                        const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                                        const isToday = day === today.getDate() && m === today.getMonth() && y === today.getFullYear()
                                        const currentVal = calendarPicker.field === 'start' ? exportDateRange.start : exportDateRange.end
                                        const isSelected = dateStr === currentVal
                                        return (
                                            <div
                                                key={i}
                                                className={`day-cell${isSelected ? ' selected' : ''}${isToday ? ' today' : ''}`}
                                                onClick={() => {
                                                    setExportDateRange(prev => ({ ...prev, [calendarPicker.field]: dateStr }))
                                                    setCalendarPicker(null)
                                                }}
                                            >{day}</div>
                                        )
                                    })
                                })()}
                            </div>
                              </>
                            )}
                        </div>
                        <div className="quick-options">
                            <button onClick={() => {
                                if (calendarPicker.field === 'start') {
                                    const d = new Date(); d.setMonth(d.getMonth() - 1)
                                    setExportDateRange(prev => ({ ...prev, start: d.toISOString().split('T')[0] }))
                                } else {
                                    setExportDateRange(prev => ({ ...prev, end: new Date().toISOString().split('T')[0] }))
                                }
                                setCalendarPicker(null)
                            }}>{calendarPicker.field === 'start' ? '一个月前' : '今天'}</button>
                            <button onClick={() => {
                                if (calendarPicker.field === 'start') {
                                    const d = new Date(); d.setMonth(d.getMonth() - 3)
                                    setExportDateRange(prev => ({ ...prev, start: d.toISOString().split('T')[0] }))
                                } else {
                                    const d = new Date(); d.setMonth(d.getMonth() - 1)
                                    setExportDateRange(prev => ({ ...prev, end: d.toISOString().split('T')[0] }))
                                }
                                setCalendarPicker(null)
                            }}>{calendarPicker.field === 'start' ? '三个月前' : '一个月前'}</button>
                        </div>
                        <div className="dialog-footer">
                            <button className="cancel-btn" onClick={() => { setCalendarPicker(null); setShowYearMonthPicker(false) }}>取消</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
