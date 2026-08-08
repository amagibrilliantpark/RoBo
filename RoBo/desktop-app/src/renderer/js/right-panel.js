/** Update the session name displayed in the right panel header. */
function updateSessionName(title) {
  const el = document.getElementById('rpSessionName');
  if (el) el.textContent = title;
}

/** Update the context ring (inside the prompt box) and its hover modal.
 *  The ring is an empty donut whose arc fills with usage. The fill color
 *  only climbs through ACCENT tones (soft -> mid -> deep), never clashing
 *  with the theme. The modal opens instantly on hover — no animation. */
function updateContextStats(tokenData) {
  const ring = document.getElementById('ctxRing');
  const fill = document.getElementById('ctxRingFill');
  if (!ring || !fill) return;

  let tokens = 0;
  let cost = 0;
  let maxTokens = 0;

  if (tokenData) {
    const input = tokenData.input || 0;
    const output = tokenData.output || 0;
    const reasoning = tokenData.reasoning || 0;
    tokens = input + output + reasoning;
    cost = tokenData.cost || 0;
  }

  // Get max context from current model
  if (window.App.currentModel && window.App.providers) {
    const allProviders = window.App.providers.all || [];
    for (const p of allProviders) {
      if (p.id === window.App.currentModel.provider && p.models) {
        let model = p.models[window.App.currentModel.model];
        if (!model) {
          const modelArray = Object.values(p.models);
          model = modelArray.find(m => m.id === window.App.currentModel.model);
        }
        if (model) {
          maxTokens = (model.limit && model.limit.context) || model.context_length || model.contextLength || 0;
        }
        break;
      }
    }
  }

  const percent = maxTokens > 0 ? Math.min(100, Math.round((tokens / maxTokens) * 100)) : 0;
  const CIRC = 2 * Math.PI * 7.5;
  fill.style.strokeDashoffset = (CIRC * (1 - percent / 100)).toFixed(2);
  ring.classList.remove('lv-soft', 'lv-mid', 'lv-deep');
  ring.classList.add(percent < 60 ? 'lv-soft' : percent < 85 ? 'lv-mid' : 'lv-deep');

  const set = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  set('ctxTokens', tokens > 0 && maxTokens > 0
    ? `${tokens.toLocaleString('en-US')} / ${maxTokens.toLocaleString('en-US')}`
    : '0');
  set('ctxPercent', maxTokens > 0 ? `${percent}%` : '—');
  set('ctxCost', cost > 0 ? `$${cost.toFixed(4)}` : '$0.00');
}

/** Render the todo list with checkboxes in the right panel. */
function updateTodoList(todos) {
  const container = document.getElementById('todoList');
  if (!container) return;

  container.innerHTML = '';

  if (!todos || todos.length === 0) return;

  const frag = document.createDocumentFragment();
  for (const todo of todos) {
    const item = document.createElement('div');
    item.className = 'rp-todo-item';

    // Highlight in_progress todo with accent color
    if (todo.status === 'in_progress') {
      item.classList.add('rp-todo-item-active');
    }

    const check = document.createElement('span');
    check.className = 'todo-check';
    const isCompleted = todo.status === 'completed';
    check.textContent = isCompleted ? '[x]' : '[ ]';

    const text = document.createTextNode(todo.content || 'Todo');

    item.appendChild(check);
    item.appendChild(text);
    frag.appendChild(item);
  }
  container.appendChild(frag);
}

/** Clear all todo items from the right panel. */
function clearTodoList() {
  const container = document.getElementById('todoList');
  if (container) container.innerHTML = '';
}

/** Update the SyncRo status in the right panel. */
function updateSyncRoStatus(status) {
  const el = document.getElementById('rpSyncRoStatus');
  if (el) {
    el.textContent = status || 'Unknown';
    el.className = 'rp-syncro-status ' + (status === 'Running' ? 'running' : 'stopped');
  }
}

function aggregateTokensFromMessages(messages) {
  let input = 0, output = 0, reasoning = 0, cost = 0;
  const list = messages.value || messages || [];
  for (const msg of list) {
    const info = msg.info || msg;
    if (info.role === 'assistant' && info.tokens) {
      input += info.tokens.input || 0;
      output += info.tokens.output || 0;
      reasoning += info.tokens.reasoning || 0;
    }
    if (info.role === 'assistant' && typeof info.cost === 'number') {
      cost += info.cost;
    }
  }
  return { input, output, reasoning, cost };
}

window.RightPanel = { updateSessionName, updateContextStats, updateTodoList, clearTodoList, updateSyncRoStatus, aggregateTokensFromMessages };
