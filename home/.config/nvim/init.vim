" Minimal Neovim configuration.

" Editing
set number
set cursorline
set expandtab
set tabstop=4
set softtabstop=4
set shiftwidth=4
set textwidth=0
set nospell

" Search and completion
set ignorecase
set smartcase
set completeopt=menuone,noselect
set inccommand=split

" Windows and context
set splitbelow
set splitright
set scrolloff=4
set sidescrolloff=4
set signcolumn=yes

" Persistence and safety
set undofile
set swapfile
set confirm

" Terminal and display
set mouse=a
set clipboard=unnamedplus
set list
set listchars=tab:»\ ,trail:·,nbsp:␣

" Colors come from the terminal (Ghostty theme): no termguicolors, default colorscheme.
" Plugins (built-in vim.pack). Parsers: :TSInstall <lang>, needs tree-sitter CLI.
lua vim.pack.add({ 'https://github.com/nvim-treesitter/nvim-treesitter' })

" Clear search highlighting with Escape in normal mode.
nnoremap <silent> <Esc> <Cmd>nohlsearch<CR>

" File tree (netrw) on the left: <Space>b, or Cmd+B like VS Code.
let mapleader = ' '
let g:netrw_banner = 0
let g:netrw_liststyle = 3
let g:netrw_winsize = 25
nnoremap <leader>b <Cmd>Lexplore<CR>
nnoremap <D-b> <Cmd>Lexplore<CR>

augroup dotfiles
    autocmd!
    autocmd FileType * lua pcall(vim.treesitter.start)
    autocmd FileType netrw nmap <buffer> <nowait> <Space> <CR>
    autocmd FileType markdown setlocal wrap linebreak breakindent
    autocmd FileType markdown nnoremap <buffer><expr> j v:count == 0 ? 'gj' : 'j'
    autocmd FileType markdown nnoremap <buffer><expr> k v:count == 0 ? 'gk' : 'k'
augroup END
