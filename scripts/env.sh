#!/usr/bin/env bash

# ==============================================================================
# Script: format_env.sh
# Description: 
#   Reads and cleans up a .env file. It smartly handles formatting by:
#   1. Removing full-line and inline comments (safely ignoring '#' inside quotes).
#   2. Removing spaces around the '=' separator (e.g. 'KEY = VAL' -> 'KEY=VAL').
#   3. Removing empty lines.
#   4. Excluding everything after '# NOTE: development'.
#   5. Ensuring the final output ends with an empty line.
#   6. Automatically copies output to clipboard when no target file is provided.
#
# Usage:
#   ./scripts/env.sh [source_file] [target_file]
#
# Examples:
#   # 1. Default (reads ../.env, outputs to terminal)
#   ./scripts/env.sh
#
#   # 2. Read specific file, output to terminal
#   ./scripts/env.sh ./my_folder/.env
#
#   # 3. Read specific file, save to target file
#   ./scripts/env.sh ./.env ./.env.clean
# ==============================================================================

# Get the absolute path of the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &> /dev/null && pwd)"

# Define source file: use argument 1, or default to one level up from script dir
SRC_FILE="${1:-$SCRIPT_DIR/../.env}"

# Define target file: use argument 2, or leave empty for stdout
TARGET_FILE="${2:-}"

# Check if the source file actually exists
if [ ! -f "$SRC_FILE" ]; then
    echo "Error: Source file '$SRC_FILE' does not exist." >&2
    exit 1
fi

# We use awk to handle the complex parsing (quotes, inline comments, markers)
AWK_SCRIPT='
# Exit immediately if we hit the development note
/^[[:space:]]*#[[:space:]]*NOTE:[[:space:]]*development/ { exit }

{
    line = $0
    
    # Remove leading whitespace
    sub(/^[[:space:]]+/, "", line)
    
    # Skip full comment lines and empty lines
    if (line ~ /^#/ || line ~ /^$/) next
    
    # Parse character by character to safely handle quotes and find inline comments
    out = ""
    in_quote = ""
    for (i=1; i<=length(line); i++) {
        c = substr(line, i, 1)
        if (in_quote) {
            out = out c
            if (c == in_quote) in_quote = "" # Close quote
        } else {
            if (c == "\"" || c == "\047") { # Double or single quote (\047)
                in_quote = c
                out = out c
            } else if (c == "#") {
                # Start of an inline comment (not in quotes), break out
                break
            } else {
                out = out c
            }
        }
    }
    
    # Remove trailing spaces from the resulting string
    sub(/[[:space:]]+$/, "", out)
    
    # Format "key = value" -> "key=value" around the FIRST "=" sign
    idx = index(out, "=")
    if (idx > 0) {
        key = substr(out, 1, idx-1)
        val = substr(out, idx+1)
        
        # Trim spaces around key and val
        sub(/[[:space:]]+$/, "", key)
        sub(/^[[:space:]]+/, "", val)
        
        out = key "=" val
    }
    
    if (length(out) > 0) {
        print out
    }
}
END {
    # Add an empty line break at the very end of the output
    print ""
}
'

if [ -z "$TARGET_FILE" ]; then
    # Output directly to terminal and copy to clipboard
    TMP_FILE=$(mktemp)
    awk "$AWK_SCRIPT" "$SRC_FILE" > "$TMP_FILE"
    
    # Print to terminal
    cat "$TMP_FILE"
    
    # Try to copy to clipboard based on available OS utilities
    if command -v pbcopy >/dev/null 2>&1; then
        cat "$TMP_FILE" | pbcopy
        echo -e "\033[0;32m[ ✓ Copied to clipboard (pbcopy) ]\033[0m" >&2
    elif command -v xclip >/dev/null 2>&1; then
        cat "$TMP_FILE" | xclip -selection clipboard
        echo -e "\033[0;32m[ ✓ Copied to clipboard (xclip) ]\033[0m" >&2
    elif command -v xsel >/dev/null 2>&1; then
        cat "$TMP_FILE" | xsel --clipboard --input
        echo -e "\033[0;32m[ ✓ Copied to clipboard (xsel) ]\033[0m" >&2
    elif command -v clip.exe >/dev/null 2>&1; then
        cat "$TMP_FILE" | clip.exe
        echo -e "\033[0;32m[ ✓ Copied to clipboard (clip.exe) ]\033[0m" >&2
    fi
    
    # Clean up temp file
    rm -f "$TMP_FILE"
else
    # Output to the specified target file
    awk "$AWK_SCRIPT" "$SRC_FILE" > "$TARGET_FILE"
    echo "Successfully formatted: '$SRC_FILE' -> '$TARGET_FILE'"
fi