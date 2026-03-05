import { NgModule, Injector } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { ConfigProvider, HotkeyProvider, ToolbarButtonProvider, AppService } from 'tabby-core'
import AppModule from 'tabby-core'
import { SettingsTabProvider } from 'tabby-settings'

import { SysmonConfigProvider, SysmonHotkeyProvider } from './services/config.provider'
import { SysmonToolbarButtonProvider } from './services/toolbar-button.provider'
import { SysmonSettingsTabProvider } from './services/settings-tab.provider'
import { SidebarInjectorService } from './services/sidebar-injector.service'
import { SysmonSidebarComponent } from './components/sidebar/sysmon-sidebar.component'
import { SysmonSettingsComponent } from './components/settings/sysmon-settings.component'

@NgModule({
    imports: [CommonModule, FormsModule, AppModule],
    providers: [
        { provide: ConfigProvider, multi: true, useFactory: () => new SysmonConfigProvider() },
        { provide: HotkeyProvider, multi: true, useFactory: () => new SysmonHotkeyProvider() },
        { provide: ToolbarButtonProvider, multi: true, useFactory: (inj: Injector) => new SysmonToolbarButtonProvider(inj), deps: [Injector] },
        { provide: SettingsTabProvider, multi: true, useFactory: () => new SysmonSettingsTabProvider() },
    ],
    declarations: [SysmonSidebarComponent, SysmonSettingsComponent],
    entryComponents: [SysmonSidebarComponent, SysmonSettingsComponent],
})
export default class SysmonModule {
    constructor (private injector: Injector) {
        const appService = this.injector.get(AppService)
        const sidebarInjector = this.injector.get(SidebarInjectorService)
        appService.ready$.subscribe(() => {
            sidebarInjector.init()
        })
    }
}
