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

    -- render-markdown.nvim: colored headings and gray code borders, no backgrounds.
    -- The plugin replaces empty groups with its defaults, so these link to Normal.
    RenderMarkdownH1 = { ctermfg = 4, bold = true },
    RenderMarkdownH2 = { ctermfg = 5, bold = true },
    RenderMarkdownH3 = { ctermfg = 6, bold = true },
    RenderMarkdownH4 = { ctermfg = 2, bold = true },
    RenderMarkdownH5 = { ctermfg = 3, bold = true },
    RenderMarkdownH6 = { ctermfg = 1, bold = true },
    RenderMarkdownH1Bg = { link = "Normal" },
    RenderMarkdownH2Bg = { link = "Normal" },
    RenderMarkdownH3Bg = { link = "Normal" },
    RenderMarkdownH4Bg = { link = "Normal" },
    RenderMarkdownH5Bg = { link = "Normal" },
    RenderMarkdownH6Bg = { link = "Normal" },
    RenderMarkdownCode = { link = "Normal" },
    RenderMarkdownCodeInline = { link = "Normal" },
    RenderMarkdownCodeBorder = { ctermbg = 8 },
    RenderMarkdownCodeInfo = { ctermfg = 8 },
}

for name, spec in pairs(groups) do
    vim.api.nvim_set_hl(0, name, spec)
end

for level = 1, 6 do
    vim.api.nvim_set_hl(0, "@markup.heading." .. level .. ".markdown", { link = "RenderMarkdownH" .. level })
end
