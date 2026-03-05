import { Injector } from '@angular/core'
import { ToolbarButtonProvider, ToolbarButton } from 'tabby-core'

export class SysmonToolbarButtonProvider extends ToolbarButtonProvider {
    constructor (private injector: Injector) {
        super()
    }

    provide (): ToolbarButton[] {
        return [{
            icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <rect x="6" y="6" width="12" height="12" rx="1.5"/>
  <line x1="9" y1="6" x2="9" y2="3"/><line x1="12" y1="6" x2="12" y2="3"/><line x1="15" y1="6" x2="15" y2="3"/>
  <line x1="9" y1="21" x2="9" y2="18"/><line x1="12" y1="21" x2="12" y2="18"/><line x1="15" y1="21" x2="15" y2="18"/>
  <line x1="6" y1="9" x2="3" y2="9"/><line x1="6" y1="12" x2="3" y2="12"/><line x1="6" y1="15" x2="3" y2="15"/>
  <line x1="21" y1="9" x2="18" y2="9"/><line x1="21" y1="12" x2="18" y2="12"/><line x1="21" y1="15" x2="18" y2="15"/>
</svg>`,
            title: 'Toggle System Monitor',
            weight: 10,
            click: () => {
                const { SidebarInjectorService } = require('./sidebar-injector.service')
                const sidebarInjector = this.injector.get(SidebarInjectorService)
                sidebarInjector.toggle()
            },
        }]
    }
}
