import { Injectable, Injector } from '@angular/core'
import { Observable, of, interval, merge, timer } from 'rxjs'
import { debounceTime, distinctUntilChanged, filter, map, switchMap, shareReplay, catchError, take, timeout, startWith } from 'rxjs/operators'
import { TrackedSSHSession } from '../interfaces/ssh-session'

let AppService: any = null
let SSHTabComponent: any = null

try {
    AppService = require('tabby-core').AppService
} catch {
    console.warn('[tabby-sysmon] tabby-core not available')
}

try {
    SSHTabComponent = require('tabby-ssh').SSHTabComponent
} catch {
    console.warn('[tabby-sysmon] tabby-ssh not available, SSH monitoring disabled')
}

@Injectable({ providedIn: 'root' })
export class SSHSessionTrackerService {
    activeSSHSession$: Observable<TrackedSSHSession | null>

    constructor (private injector: Injector) {
        this.activeSSHSession$ = this.createSessionStream()
    }

    private createSessionStream (): Observable<TrackedSSHSession | null> {
        if (!AppService) {
            console.warn('[tabby-sysmon] AppService not loaded')
            return of(null)
        }

        let appService: any
        try {
            appService = this.injector.get(AppService)
        } catch (e) {
            console.warn('[tabby-sysmon] Could not inject AppService:', e)
            return of(null)
        }

        // Tabby v1.0.230: activeTabChange (EventEmitter), not activeTab$
        const tabChange$ = appService.activeTab$ ?? appService.activeTabChange
        if (!tabChange$) {
            console.warn('[tabby-sysmon] No activeTab$/activeTabChange on AppService')
            return of(null)
        }

        // Get current active tab for startWith
        const currentTab = appService.activeTab ?? appService._activeTab ?? null
        console.debug('[tabby-sysmon] SSH tracker: using', appService.activeTab$ ? 'activeTab$' : 'activeTabChange',
            ', current tab:', currentTab?.constructor?.name)

        const mainStream$ = tabChange$.pipe(
            startWith(currentTab),
        )
        const startupRecheck$ = timer(2000, 3000).pipe(
            take(3),
            map(() => appService.activeTab ?? appService._activeTab ?? null),
            filter(tab => tab !== null),
        )

        return merge(mainStream$, startupRecheck$).pipe(
            distinctUntilChanged(),
            switchMap((rawTab: any): Observable<TrackedSSHSession | null> => {
                if (!rawTab) return of(null)
                console.debug('[tabby-sysmon] Active tab:', rawTab.constructor?.name)

                const tab = this.unwrapTab(rawTab)
                if (!this.isSSHTab(tab)) return of(null)

                const immediate = this.extractSSHSession(tab)
                if (immediate) return of(immediate)

                // Session not ready yet — wait for it
                if (tab.sessionChanged$) {
                    return tab.sessionChanged$.pipe(
                        startWith(null),
                        map(() => this.extractSSHSession(tab)),
                        filter((s: TrackedSSHSession | null) => s !== null),
                        take(1),
                        timeout(30000),
                        catchError(() => of(null)),
                    )
                }

                // Fallback: poll every 500ms for up to 30s
                return interval(500).pipe(
                    take(60),
                    map(() => this.extractSSHSession(tab)),
                    filter((s: TrackedSSHSession | null) => s !== null),
                    take(1),
                    timeout(30000),
                    catchError(() => of(null)),
                )
            }),
            debounceTime(300),
            shareReplay(1),
            catchError(err => {
                console.error('[tabby-sysmon] SSH session tracking error:', err)
                return of(null)
            }),
        )
    }

    private unwrapTab (tab: any): any {
        // SplitTabComponent wraps actual tabs — dig into focused child
        if (tab.constructor?.name === 'SplitTabComponent') {
            const child = tab.focusedTab ?? tab._focusedTab ?? tab.activeTab
                ?? (tab.getAllTabs?.())?.[0] ?? (tab.children$?.value)?.[0]
                ?? tab._children?.[0]
            if (child && child !== tab) {
                console.debug('[tabby-sysmon] Unwrapped SplitTab →', child.constructor?.name,
                    'keys:', Object.getOwnPropertyNames(child).slice(0, 25))
                // Log prototype too for getters
                const proto = Object.getPrototypeOf(child)
                if (proto) {
                    console.debug('[tabby-sysmon] Child proto keys:', Object.getOwnPropertyNames(proto).slice(0, 25))
                }
                return child
            }
            // Can't find child — log everything to debug
            const allKeys = [
                ...Object.getOwnPropertyNames(tab),
                ...Object.getOwnPropertyNames(Object.getPrototypeOf(tab) || {}),
            ]
            console.debug('[tabby-sysmon] SplitTab all keys:', allKeys.slice(0, 40))
            return tab
        }
        return tab
    }

    private isSSHTab (tab: any): boolean {
        if (SSHTabComponent && tab instanceof SSHTabComponent) return true
        if (tab.sshSession !== undefined) return true
        if (tab.session?.ssh !== undefined) return true
        if (tab.constructor?.name === 'SSHTabComponent') return true
        console.debug('[tabby-sysmon] Tab not SSH:', tab.constructor?.name)
        return false
    }

    private extractSSHSession (tab: any): TrackedSSHSession | null {
        if (!this.isSSHTab(tab)) return null

        const sshSession = tab.sshSession ?? tab.session
        if (!sshSession) {
            console.debug('[tabby-sysmon] No sshSession on tab:', Object.keys(tab).slice(0, 20))
            return null
        }

        const sshClient = sshSession.ssh ?? sshSession.client ?? sshSession.sshClient ?? null
        if (!sshClient) {
            console.debug('[tabby-sysmon] No SSH client found. Session keys:', Object.keys(sshSession).slice(0, 20))
            return null
        }

        const hostname = tab.profile?.options?.host
            ?? sshSession.profile?.options?.host
            ?? tab.customTitle
            ?? 'unknown'

        const username = tab.profile?.options?.user
            ?? sshSession.profile?.options?.user
            ?? ''

        return {
            sshClient,
            sshSession,
            hostname,
            username,
            profile: tab.profile ?? sshSession.profile ?? null,
        }
    }
}