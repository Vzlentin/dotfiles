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
if executable('pbcopy')
    set clipboard=unnamedplus
elseif !empty($DISPLAY) && (executable('xclip') || executable('xsel'))
    set clipboard=unnamedplus
elseif !empty($WAYLAND_DISPLAY) && executable('wl-copy')
    set clipboard=unnamedplus
endif
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
    autocmd FileType * setlocal textwidth=0 nospell
    autocmd FileType markdown setlocal wrap linebreak breakindent
    autocmd FileType markdown nnoremap <buffer><expr> j v:count == 0 ? 'gj' : 'j'
    autocmd FileType markdown nnoremap <buffer><expr> k v:count == 0 ? 'gk' : 'k'
augroup END
