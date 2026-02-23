#!/bin/bash
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).tool_input.file_path||'')}catch{console.log('')}})" 2>/dev/null)

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

if [[ "$FILE_PATH" == *frontend* && ("$FILE_PATH" == *.jsx || "$FILE_PATH" == *.js || "$FILE_PATH" == *.ts || "$FILE_PATH" == *.tsx) ]]; then
  FRONTEND_DIR="$CLAUDE_PROJECT_DIR/frontend/char-chat-frontend"
  if [ -d "$FRONTEND_DIR" ]; then
    cd "$FRONTEND_DIR"
    OUTPUT=$(npx vite build 2>&1)
    if [ $? -ne 0 ]; then
      echo "=== FRONTEND BUILD FAILED ===" >&2
      echo "$OUTPUT" | grep -E "error|Error|ERROR" | head -20 >&2
      echo "$OUTPUT" | tail -10 >&2
      exit 2
    fi
  fi
elif [[ "$FILE_PATH" == *backend-api* && "$FILE_PATH" == *.py ]]; then
  PYTHON_CMD="python3"
  command -v python &>/dev/null && PYTHON_CMD="python"
  OUTPUT=$($PYTHON_CMD -m py_compile "$FILE_PATH" 2>&1)
  if [ $? -ne 0 ]; then
    echo "=== PYTHON SYNTAX ERROR ===" >&2
    echo "$OUTPUT" >&2
    exit 2
  fi
fi

exit 0
