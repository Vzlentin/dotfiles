vim.g.mapleader = " "

-- Editing
vim.o.number = true
vim.o.cursorline = true
vim.o.cursorlineopt = "number"
vim.o.expandtab = true
vim.o.tabstop = 4
vim.o.softtabstop = 4
vim.o.shiftwidth = 4

-- Search
vim.o.ignorecase = true
vim.o.smartcase = true
vim.o.inccommand = "split"

-- Windows and context
vim.o.splitbelow = true
vim.o.splitright = true
vim.o.scrolloff = 4
vim.o.sidescrolloff = 4
vim.o.signcolumn = "yes"
vim.o.laststatus = 3
vim.opt.fillchars = { eob = " " }

-- Persistence and safety
vim.o.undofile = true
vim.o.confirm = true

-- Terminal and display
vim.o.mouse = "a"
vim.o.clipboard = "unnamedplus"
vim.o.list = true
vim.opt.listchars = { tab = "» ", trail = "·", nbsp = "␣" }
-- Palette indexes instead of RGB, so colors come from the terminal theme.
vim.o.termguicolors = false
vim.cmd("colorscheme terminal")

vim.keymap.set("n", "<Esc>", "<Cmd>nohlsearch<CR>", { silent = true })

local group = vim.api.nvim_create_augroup("dotfiles", {})

vim.api.nvim_create_autocmd("FileType", {
    group = group,
    callback = function() pcall(vim.treesitter.start) end,
})

vim.api.nvim_create_autocmd("FileType", {
    group = group,
    pattern = "markdown",
    callback = function()
        vim.opt_local.wrap = true
        vim.opt_local.linebreak = true
        vim.opt_local.breakindent = true
        vim.keymap.set("n", "j", "v:count == 0 ? 'gj' : 'j'", { buffer = true, expr = true })
        vim.keymap.set("n", "k", "v:count == 0 ? 'gk' : 'k'", { buffer = true, expr = true })
    end,
})

-- Debian and Ubuntu apt packages are older; they get only the settings above.
if vim.fn.has("nvim-0.12") == 0 then
    return
end

vim.o.winborder = "rounded"
vim.o.pumborder = "rounded"
vim.diagnostic.config({ virtual_text = true })

-- Completion from open buffers as you type; Tab and Shift+Tab move in the menu.
vim.o.autocomplete = true
vim.o.complete = ".^5,w^5,b^5,u^5"
vim.o.completeopt = "menuone,noselect,popup"
vim.keymap.set("i", "<Tab>", function() return vim.fn.pumvisible() == 1 and "<C-n>" or "<Tab>" end, { expr = true })
vim.keymap.set("i", "<S-Tab>", function() return vim.fn.pumvisible() == 1 and "<C-p>" or "<S-Tab>" end, { expr = true })

local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
if not vim.uv.fs_stat(lazypath) then
    local out = vim.fn.system({
        "git", "clone", "--filter=blob:none", "--branch=stable",
        "https://github.com/folke/lazy.nvim.git", lazypath,
    })
    if vim.v.shell_error ~= 0 then
        error("Cannot clone lazy.nvim:\n" .. out)
    end
end
vim.opt.rtp:prepend(lazypath)

require("lazy").setup({
    {
        "nvim-treesitter/nvim-treesitter",
        lazy = false,
        build = ":TSUpdate",
        cond = vim.fn.executable("tree-sitter") == 1,
        config = function()
            require("nvim-treesitter").install({
                "bash", "json", "python", "toml", "typescript", "yaml",
            })
        end,
    },
    {
        "folke/snacks.nvim",
        lazy = false,
        priority = 1000,
        opts = {
            explorer = { enabled = true },
            picker = {
                enabled = true,
                sources = { explorer = { hidden = true } },
            },
        },
        keys = {
            { "<leader>e", function() Snacks.explorer() end, desc = "File tree" },
            { "<D-b>", function() Snacks.explorer() end, desc = "File tree" },
            { "<leader><space>", function() Snacks.picker.files() end, desc = "Find files" },
            { "<leader>/", function() Snacks.picker.grep() end, desc = "Search text" },
            { "<leader>,", function() Snacks.picker.buffers() end, desc = "Buffers" },
        },
    },
    { "nvim-mini/mini.icons", lazy = true, opts = {} },
    { "lewis6991/gitsigns.nvim", opts = {} },
}, {
    install = { colorscheme = { "terminal" } },
    rocks = { enabled = false },
    ui = { border = "rounded" },
})

if vim.fn.executable("ruff") == 1 then
    vim.lsp.config("ruff", {
        cmd = { "ruff", "server" },
        filetypes = { "python" },
        root_markers = { "pyproject.toml", "ruff.toml", ".ruff.toml", ".git" },
    })
    vim.lsp.enable("ruff")
end

vim.keymap.set("n", "<leader>f", vim.lsp.buf.format, { desc = "Format" })
