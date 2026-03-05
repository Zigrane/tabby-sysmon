import { ConfigProvider, HotkeyProvider, HotkeyDescription, Platform } from 'tabby-core'

export class SysmonConfigProvider extends ConfigProvider {
    defaults = {
        sysmon: {
            enabled: true,
            refreshIntervalMs: 2000,
            panelHeight: 50,
            showCpu: true,
            showMemory: true,
            showDisk: true,
            showNetwork: true,
            showConnections: true,
            showSshSessions: true,
            diskMountPoint: '/',
            autoSwitchToRemote: true,
            connectionsRefreshMultiplier: 3,
        },
        hotkeys: {
            'sysmon.toggle-sidebar': ['Ctrl+Shift+M'],
        },
    }

    platformDefaults = {
        [Platform.Windows]: {
            sysmon: {
                diskMountPoint: 'C:',
            },
        },
        [Platform.macOS]: {
            hotkeys: {
                'sysmon.toggle-sidebar': ['Cmd+Shift+M'],
            },
        },
        [Platform.Linux]: {},
        [Platform.Web]: {},
    }
}

export class SysmonHotkeyProvider extends HotkeyProvider {
    async provide (): Promise<HotkeyDescription[]> {
        return [
            {
                id: 'sysmon.toggle-sidebar',
                name: 'Toggle System Monitor Panel',
            },
        ]
    }
}
