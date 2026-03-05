import { Component } from '@angular/core'
import { ConfigService } from 'tabby-core'

@Component({
    selector: 'sysmon-settings',
    template: require('./sysmon-settings.component.pug'),
    styles: [require('./sysmon-settings.component.scss')],
})
export class SysmonSettingsComponent {
    constructor (public config: ConfigService) {}

    get sysmon () { return this.config.store.sysmon }

    save (): void {
        this.config.save()
    }
}
