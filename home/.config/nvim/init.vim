" Minimal Neovim configuration.

" Editing
set number
set relativenumber
set cursorline
set expandtab
set tabstop=4
set softtabstop=4
set shiftwidth=4
set textwidth=0
set breakindent
set linebreak
set spell

" Search and completion
set ignorecase
set smartcase
set completeopt=menuone,noselect,popup
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
set termguicolors
set list
set listchars=tab:»\ ,trail:·,nbsp:␣
syntax on

highlight Normal guibg=none
highlight NonText guibg=none
highlight Normal ctermbg=none
highlight NonText ctermbg=none

" Clear search highlighting with Escape in normal mode.
nnoremap <silent> <Esc> <Cmd>nohlsearch<CR>

augroup dotfiles
    autocmd!
    autocmd FileType * setlocal textwidth=0
augroup END
