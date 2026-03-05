import { SettingsTabProvider } from 'tabby-settings'
import { SysmonSettingsComponent } from '../components/settings/sysmon-settings.component'

export class SysmonSettingsTabProvider extends SettingsTabProvider {
    id = 'sysmon'
    icon = ''
    title = 'System Monitor'
    weight = 50
    prioritized = false

    getComponentType (): any {
        return SysmonSettingsComponent
    }
}
