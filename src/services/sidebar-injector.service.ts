import { Injectable, ComponentFactoryResolver, ApplicationRef, Injector, ComponentRef } from '@angular/core'
import { Subscription } from 'rxjs'
import { filter } from 'rxjs/operators'
import { ConfigService, HotkeysService } from 'tabby-core'
import { MetricsOrchestratorService } from './metrics-orchestrator.service'
import { SysmonSidebarComponent } from '../components/sidebar/sysmon-sidebar.component'

@Injectable({ providedIn: 'root' })
export class SidebarInjectorService {
    private componentRef: ComponentRef<SysmonSidebarComponent> | null = null
    private sidebarHost: HTMLElement | null = null
    private innerContent: HTMLElement | null = null
    private styleTag: HTMLStyleElement | null = null
    private subscriptions: Subscription[] = []
    private initialized = false
    private retryCount = 0
    private rafId: number | null = null
    private resizeTimeout: number | null = null
    private positionWasSet = false

    private readonly MAX_RETRIES = 5
    private readonly STYLE_TAG_ID = 'sysmon-sidebar-styles'

    constructor (
        private cfr: ComponentFactoryResolver,
        private appRef: ApplicationRef,
        private injector: Injector,
        private config: ConfigService,
        private hotkeys: HotkeysService,
        private orchestrator: MetricsOrchestratorService,
    ) {}

    init (): void {
        if (this.initialized) return
        this.initialized = true

        // Subscribe to hotkey
        this.subscriptions.push(
            this.hotkeys.hotkey$.pipe(
                filter(hotkey => hotkey === 'sysmon.toggle-sidebar'),
            ).subscribe(() => this.toggle()),
        )

        // Subscribe to config changes
        this.subscriptions.push(
            this.config.changed$.subscribe(() => this.applyConfig()),
        )

        // Inject into DOM
        this.injectIntoDOM()
    }

    toggle (): void {
        this.orchestrator.setCollapsed(!this.orchestrator.getCollapsed())
    }

    show (): void {
        this.orchestrator.setCollapsed(false)
    }

    hide (): void {
        this.orchestrator.setCollapsed(true)
    }

    destroy (): void {
        // Unsubscribe all
        for (const sub of this.subscriptions) sub.unsubscribe()
        this.subscriptions = []

        // Cancel pending RAF and resize timeout
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId)
            this.rafId = null
        }
        if (this.resizeTimeout !== null) {
            clearTimeout(this.resizeTimeout)
            this.resizeTimeout = null
        }

        // Detach + destroy component
        if (this.componentRef) {
            this.appRef.detachView(this.componentRef.hostView)
            this.componentRef.destroy()
            this.componentRef = null
        }

        // Clean up DOM — reset CSS var so terminal goes back to full height
        if (this.innerContent) {
            this.innerContent.style.setProperty('--sysmon-height', '0px')
        }

        // Remove sidebar host
        if (this.sidebarHost && this.sidebarHost.parentNode) {
            this.sidebarHost.parentNode.removeChild(this.sidebarHost)
            this.sidebarHost = null
        }

        // Remove style tag
        if (this.styleTag && this.styleTag.parentNode) {
            this.styleTag.parentNode.removeChild(this.styleTag)
            this.styleTag = null
        }

        // Reset position if we set it
        if (this.positionWasSet && this.innerContent) {
            this.innerContent.style.position = ''
            this.positionWasSet = false
        }

        this.innerContent = null
        this.retryCount = 0
        this.positionWasSet = false
        this.initialized = false
    }

    private injectIntoDOM (): void {
        const innerContent = this.findInnerContent()
        if (!innerContent) {
            this.retryWithBackoff()
            return
        }
        this.performInjection(innerContent)
    }

    private retryWithBackoff (): void {
        if (!this.initialized || this.retryCount >= this.MAX_RETRIES) {
            console.warn('[tabby-sysmon] Could not find inner content div after', this.retryCount, 'retries')
            return
        }
        const delay = 200 * Math.pow(2, this.retryCount)
        this.retryCount++
        setTimeout(() => {
            if (!this.initialized) return
            const el = this.findInnerContent()
            if (el) {
                this.performInjection(el)
            } else {
                this.retryWithBackoff()
            }
        }, delay)
    }

    private findInnerContent (): HTMLElement | null {
        const allContent = document.querySelectorAll('.content')
        for (let i = 0; i < allContent.length; i++) {
            const el = allContent[i] as HTMLElement
            if (el.querySelector('.content-tab') || el.querySelector('start-page')) {
                return el
            }
        }
        return null
    }

    private performInjection (innerContent: HTMLElement): void {
        this.innerContent = innerContent

        // Ensure innerContent has position context for absolute-positioned sidebar host
        if (window.getComputedStyle(innerContent).position === 'static') {
            innerContent.style.position = 'relative'
            this.positionWasSet = true
        }

        // 1. Clean up stale artifacts from old version or crash
        this.cleanupStaleArtifacts(innerContent)

        // 2. Inject style tag into <head>
        this.injectStyleTag()

        // 3. Create sidebar host (absolute positioned, bottom bar)
        this.sidebarHost = document.createElement('div')
        this.sidebarHost.className = 'sysmon-sidebar-host'
        this.sidebarHost.style.position = 'absolute'
        this.sidebarHost.style.bottom = '0'
        this.sidebarHost.style.left = '0'
        this.sidebarHost.style.right = '0'
        this.sidebarHost.style.zIndex = '10'
        this.sidebarHost.style.pointerEvents = 'auto'

        // 4. Append to innerContent (NO replaceChild, NO wrapper)
        innerContent.appendChild(this.sidebarHost)

        // 5. Create Angular component
        const factory = this.cfr.resolveComponentFactory(SysmonSidebarComponent)
        this.componentRef = factory.create(this.injector)
        this.appRef.attachView(this.componentRef.hostView)
        this.sidebarHost.appendChild(this.componentRef.location.nativeElement)

        // 6. Apply config (sets classes, CSS var, inputs)
        this.applyConfig()

        // 7. Subscribe to heightChanged (mouseup → save config + update CSS var)
        this.subscriptions.push(
            this.componentRef.instance.heightChanged.subscribe((height: number) => {
                this.config.store.sysmon.panelHeight = height
                this.config.save()
                this.updateCSSVariable(height)
            }),
        )

        // 8. Subscribe to heightLive (mousemove → RAF-throttled CSS var update)
        this.subscriptions.push(
            this.componentRef.instance.heightLive.subscribe((height: number) => {
                if (this.rafId === null) {
                    this.rafId = requestAnimationFrame(() => {
                        this.updateCSSVariable(height)
                        this.rafId = null
                    })
                }
            }),
        )

        // 9. Subscribe to collapsed$ → update CSS var (collapsed = 22px header only)
        this.subscriptions.push(
            this.orchestrator.collapsed$.subscribe((collapsed: boolean) => {
                if (!this.innerContent) return
                if (collapsed) {
                    this.updateCSSVariable(20)
                } else {
                    const height = this.config.store?.sysmon?.panelHeight ?? this.config.store?.sysmon?.sidebarWidth ?? 50
                    this.updateCSSVariable(height)
                }
            }),
        )
    }

    private injectStyleTag (): void {
        // Remove existing if any
        const existing = document.getElementById(this.STYLE_TAG_ID)
        if (existing) existing.parentNode?.removeChild(existing)

        this.styleTag = document.createElement('style')
        this.styleTag.id = this.STYLE_TAG_ID
        this.styleTag.textContent = this.buildCSS()
        document.head.appendChild(this.styleTag)
    }

    private buildCSS (): string {
        return `
/* sysmon bottom panel — push tab content up so terminal ends above the panel */
.content > .content-tab.content-tab-active,
.content > start-page.content-tab-active {
    height: calc(100% - var(--sysmon-height, 0px)) !important;
    bottom: auto !important;
}
`
    }

    private updateCSSVariable (height: number): void {
        if (this.innerContent) {
            this.innerContent.style.setProperty('--sysmon-height', height + 'px')
            // Trigger terminal resize so xterm recalculates visible rows
            this.triggerTerminalResize()
        }
    }

    private triggerTerminalResize (): void {
        // Debounce resize events during drag
        if (this.resizeTimeout !== null) {
            clearTimeout(this.resizeTimeout)
        }
        this.resizeTimeout = window.setTimeout(() => {
            window.dispatchEvent(new Event('resize'))
            this.resizeTimeout = null
        }, 50) as unknown as number
    }

    private applyConfig (): void {
        if (!this.componentRef || !this.innerContent) return

        const sysmon = this.config.store?.sysmon ?? {}
        const instance = this.componentRef.instance
        const height = sysmon.panelHeight ?? sysmon.sidebarWidth ?? 50
        const collapsed = this.orchestrator.getCollapsed()

        // Set component inputs
        instance.height = height
        instance.showCpu = sysmon.showCpu ?? true
        instance.showMemory = sysmon.showMemory ?? true
        instance.showDisk = sysmon.showDisk ?? true
        instance.showNetwork = sysmon.showNetwork ?? true
        instance.showConnections = sysmon.showConnections ?? true
        instance.showSshSessions = sysmon.showSshSessions ?? true

        if (collapsed) {
            this.updateCSSVariable(20)
        } else {
            this.updateCSSVariable(height)
        }

        // Trigger change detection
        this.componentRef.changeDetectorRef.markForCheck()
    }

    private cleanupStaleArtifacts (innerContent: HTMLElement): void {
        // Remove stale style tag
        const staleStyle = document.getElementById(this.STYLE_TAG_ID)
        if (staleStyle) staleStyle.parentNode?.removeChild(staleStyle)

        // Remove stale sidebar host
        const staleHost = innerContent.querySelector('.sysmon-sidebar-host')
        if (staleHost) staleHost.parentNode?.removeChild(staleHost)

        // Remove old wrapper (migration from wrapper-based version)
        const staleWrapper = innerContent.parentElement?.querySelector('.sysmon-content-wrapper')
        if (staleWrapper) {
            const parent = staleWrapper.parentElement
            if (parent) {
                while (staleWrapper.firstChild) {
                    parent.insertBefore(staleWrapper.firstChild, staleWrapper)
                }
                parent.removeChild(staleWrapper)
            }
        }

        // Clean stale CSS vars and classes from old sidebar version
        innerContent.classList.remove('sysmon-active', 'sysmon-left', 'sysmon-right')
        innerContent.style.removeProperty('--sysmon-width')
        innerContent.style.removeProperty('--sysmon-height')
        innerContent.style.removeProperty('flex')
    }
}
