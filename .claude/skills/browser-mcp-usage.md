---
name: browser-mcp-usage
description: Use when automating browser testing via Chrome DevTools Protocol MCP
---

# Browser MCP Usage Guide

## When to Use This Skill

- Automated UI testing via browser
- Interacting with web pages programmatically
- Taking screenshots for verification
- Executing JavaScript in browser context

## Key Lessons Learned

### 1. Screenshot File Naming

Browser MCP saves screenshots without `.png` extension. Always rename:

```bash
# After screenshot action
mv /path/to/screenshot /path/to/screenshot.png
```

Or check the actual file:
```bash
file /path/to/screenshot  # Shows: PNG image data...
```

### 2. DOM Action vs JavaScript Eval

**Prefer `eval` for reliability** when:
- Elements may have unusual event handlers
- You need to access JavaScript APIs
- Simple click/type actions don't work

```javascript
// More reliable than click action
action: eval
payload: document.querySelector('#myBtn').click(); 'clicked';
```

### 3. Waiting for Page State

Browser MCP doesn't automatically wait. Use:

```bash
# In between actions
sleep 2  # or sleep 3, sleep 5 for longer operations
```

Then take screenshot to verify state.

### 4. Session Directory

Browser MCP saves captures to session directories:
```
/Users/bill/Library/Caches/superpowers/browser/YYYY-MM-DD/session-TIMESTAMP/
```

Files include:
- `XXX-action.html` - Full HTML
- `XXX-action.md` - Markdown summary
- `XXX-action.png` - Screenshot
- `XXX-action-console.txt` - Console logs

### 5. Checking Page State

Use `eval` to inspect current state:

```javascript
JSON.stringify({
    currentView: document.querySelector('.view.active')?.id,
    inputValue: document.querySelector('#myInput')?.value,
    buttonEnabled: !document.querySelector('#myBtn')?.disabled
});
```

### 6. Common Issues

| Issue | Solution |
|-------|----------|
| Click doesn't work | Use `eval` with `.click()` |
| Element not found | Check selector, wait for load |
| Page not changing | Wait longer, check for async loads |
| Screenshot file not found | Add `.png` extension |
| Type action fails | Check if element is focusable |

## Best Practices

1. **Always screenshot after actions** - Verify state before next step
2. **Use `eval` for complex interactions** - More control over execution
3. **Check server logs alongside UI** - Correlate frontend/backend behavior
4. **Wait between actions** - Pages need time to update
5. **Read auto-captured files** - Check `XXX-action.png` in session dir

## Skill Evolution

**UPDATE THIS SKILL** when you discover:
- New MCP action patterns
- New debugging techniques
- New workarounds for common issues
