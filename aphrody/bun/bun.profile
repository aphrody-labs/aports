# bun-apk: one install cache and the bun global dirs (bunsh gets these from the image environment).
export BUN_INSTALL_CACHE_DIR=/var/cache/bun/install
export BUN_INSTALL_GLOBAL_DIR=/usr/local/lib/bun/global
export BUN_INSTALL_BIN=/usr/local/bin
case ":$PATH:" in
*:/usr/lib/bun/bin:*) ;;
*) PATH="$PATH:/usr/lib/bun/bin" ;;
esac
