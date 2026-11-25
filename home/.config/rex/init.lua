-- Migrated from Herdr (~/.config/herdr/config.toml) and Ghostty (~/.config/ghostty/config).

-- Herdr prefix ctrl+b: programs that use ctrl+b themselves still receive it.
rex.bind("ctrl+b>ctrl+b", "pane.send_key", { key = "ctrl+b" })

-- Herdr: previous_workspace / next_workspace
rex.bind("ctrl+alt+k", "session.previous")
rex.bind("ctrl+alt+up", "session.previous")
rex.bind("ctrl+alt+j", "session.next")
rex.bind("ctrl+alt+down", "session.next")

-- Herdr: rename_tab = "prefix+comma"
rex.bind("ctrl+b>,", "client.tab.rename")

-- Herdr: goto = "prefix+f"
rex.bind("ctrl+b>f", "session.switch")
