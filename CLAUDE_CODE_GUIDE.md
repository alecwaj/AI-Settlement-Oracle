# AI Settlement Oracle — Claude Code Build Guide

How to use Claude Code CLI to build the AI Settlement Oracle project.

---

## Prerequisites

1. **Install Claude Code CLI**
   ```bash
   npm install -g @anthropics/claude-code
   # or
   brew install claude-code
   ```

2. **Authenticate**
   ```bash
   claude login
   ```

3. **Navigate to project**
   ```bash
   cd /path/to/ai-settlement-oracle
   ```

---

## Recommended Workflow

### Option 1: Full Project Build (Recommended)

Start Claude Code in the project root with the complete prompt:

```bash
claude
```

Then paste the full build prompt from `claude-prompt.md`.

### Option 2: Component-by-Component

Build incrementally by starting Claude Code in specific directories:

```bash
# Contracts only
cd contracts && claude

# Oracle service only  
cd oracle && claude

# Demo frontend only
cd demo && claude
```

---

## Claude Code Best Practices

### 1. Start with Context

Always begin with:
- Project structure overview
- Key files to read
- Dependencies and constraints

### 2. Use `/compact` Regularly

Claude Code has context limits. Use `/compact` to summarize progress and continue.

### 3. Iterate with `/edit`

For file changes:
```
/edit path/to/file.ts
```

Then describe the change. Claude will show a diff before applying.

### 4. Run Commands with `!`

```
!npm install
!forge test
!npm run dev
```

### 5. Check Status with `/status`

Shows git status, recent commits, and file changes.

---

## Build Sequence

### Phase 1: Contracts (Solidity)

**Files to create:**
1. `contracts/src/SettlementOracle.sol`
2. `contracts/src/AttestationRegistry.sol`
3. `contracts/test/SettlementOracle.t.sol`
4. `contracts/script/Deploy.s.sol`

**Key commands:**
```bash
!forge install
!forge build
!forge test
!anvil  # local chain
!forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast
```

### Phase 2: Oracle Service (TypeScript)

**Files to create:**
1. `oracle/src/server.ts` — Express API
2. `oracle/src/ai-resolver.ts` — AI resolution logic
3. `oracle/src/attestation.ts` — EIP-712 signing
4. `oracle/src/news/guardian.ts` — Guardian API client
5. `oracle/src/news/gdelt.ts` — GDELT API client
6. `oracle/src/news/aggregator.ts` — Evidence aggregation

**Key commands:**
```bash
!npm install
!npm run dev  # starts on port 3001
```

### Phase 3: Demo Frontend (React + Vite)

**Files to create:**
1. `demo/src/App.tsx` — Main app with animation
2. `demo/src/index.css` — Styles + animations
3. `demo/src/main.tsx` — Entry point
4. `demo/src/types.ts` — TypeScript types

**Key commands:**
```bash
!npm install
!npm run dev  # starts on port 5173
```

---

## Common Claude Code Patterns

### Pattern 1: Create Multiple Files

```
Create these files:

1. src/server.ts - Express server with CORS
2. src/ai-resolver.ts - AI resolution with hardcoded NASA market
3. src/attestation.ts - EIP-712 signing

Read the existing types.ts first to understand interfaces.
```

### Pattern 2: Refactor Existing Code

```
Read demo/src/App.tsx and simplify it:
- Remove all market list/create functionality
- Keep only single NASA market display
- Add 20-second animated processing visualization
- Show verification panel on completion
```

### Pattern 3: Add Features Incrementally

```
Add to demo/src/App.tsx:
- Animated SVG network with 5 nodes
- Pulsing connection lines
- Progress bar with phase text
- Data packet animation along paths
```

### Pattern 4: Debug and Fix

```
The animation is not showing. Check:
1. Are CSS animations defined in index.css?
2. Is the SVG visible in the DOM?
3. Are the animation classes applied?

Run !npm run dev and check browser console.
```

---

## Testing with Claude Code

### Test Contracts

```
!cd contracts && forge test

If tests fail, read the output and fix the issues.
```

### Test Oracle API

```
!curl http://localhost:3001/markets

Should return the NASA market JSON.
```

### Test Frontend

```
Open http://localhost:5173 in browser.

Click "Resolve with Verifiable AI" and verify:
1. Animation plays for 20 seconds
2. Progress bar fills
3. Result shows NO with 92% confidence
4. Verification panel expands
```

---

## Claude Code Tips

### 1. Be Specific

❌ "Fix the animation"
✅ "The SVG nodes in App.tsx aren't pulsing. Check the CSS keyframes in index.css and ensure the .node-pulse class is applied to the circle elements."

### 2. Provide Context

❌ "Create a server"
✅ "Create an Express server in oracle/src/server.ts that:
- Runs on port 3001
- Has CORS enabled
- Serves a hardcoded NASA astrobiology market
- Has a /resolve endpoint that triggers AI resolution"

### 3. Use File References

```
Read demo/src/App.tsx lines 1-50.

Add a new state variable `isProcessing` after line 25.
```

### 4. Iterate on Visuals

```
The animation needs more visual polish:
- Add glow effects to active nodes
- Make connection lines gradient (purple to blue)
- Add a subtle background grid
- Ensure the progress bar has a glow
```

---

## Troubleshooting Claude Code

| Issue | Solution |
|-------|----------|
| "Context too long" | Use `/compact` to summarize |
| "File too large" | Use `/read` with line ranges |
| Changes not applied | Use `/edit` instead of asking |
| Wrong file edited | Check path with `/ls` first |
| Command not found | Use `!which node` to check PATH |

---

## Example Session

```bash
$ cd ai-settlement-oracle
$ claude

> /ls
> Read BUILD_GUIDE.md
> Read PROMPT.md
> Read the existing demo/src/App.tsx

> Create a simplified single-market version of App.tsx:
> - Remove MarketList, MarketForm components
> - Hardcode the NASA astrobiology market
> - Add 20-second processing animation
> - Show result and verification panel

[Claude creates the file]

> /edit demo/src/App.tsx
> Add data packet animation that travels along the connection lines

[Claude shows diff, you confirm]

> !npm run dev
> Open http://localhost:5173 and test

> The animation is too fast. Change duration from 20s to 25s.

[Claude updates]

> /compact

> Continue with the oracle service. Create oracle/src/server.ts...
```

---

## Resources

- **Claude Code Docs:** https://docs.anthropic.com/claude-code
- **This Project:** See PROMPT.md for full build specification
- **Foundry:** https://book.getfoundry.sh/
- **Vite:** https://vitejs.dev/
