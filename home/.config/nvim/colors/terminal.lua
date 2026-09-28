-- Uses only terminal palette indexes 0-15, so the terminal theme sets every color.
-- Many themes make index 0 equal to the background, so no group uses it as one.
vim.cmd("highlight clear")
vim.g.colors_name = "terminal"

local groups = {
    Comment = { ctermfg = 8, italic = true },
    Constant = { ctermfg = 5 },
    String = { ctermfg = 2 },
    Identifier = {},
    Function = { ctermfg = 4 },
    Statement = { ctermfg = 1 },
    PreProc = { ctermfg = 1 },
    Type = { ctermfg = 3 },
    Special = { ctermfg = 6 },

    LineNr = { ctermfg = 8 },
    NonText = { ctermfg = 8 },
    Conceal = { ctermfg = 8 },
    Folded = { ctermfg = 8 },
    WinSeparator = { ctermfg = 8 },
    StatusLine = {},
    StatusLineNC = { ctermfg = 8 },
    Pmenu = {},
    PmenuSel = { reverse = true },
    PmenuThumb = { ctermbg = 8 },
    PmenuBorder = { ctermfg = 8 },
    NormalFloat = {},
    FloatBorder = { ctermfg = 8 },
    FloatTitle = { bold = true },

    Added = { ctermfg = 2 },
    Changed = { ctermfg = 3 },
    Removed = { ctermfg = 1 },
}

for name, spec in pairs(groups) do
    vim.api.nvim_set_hl(0, name, spec)
end
