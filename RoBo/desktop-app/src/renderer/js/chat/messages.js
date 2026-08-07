/** Re-render the full message list from session history. Chain of thought
 *  rows are rebuilt from the reasoning/tool parts in the same pass, in
 *  part order — so the chain survives an app restart and stays interleaved
 *  with the answer bubbles exactly like the live stream. */
function renderMessages(messages) {
  const container = Utils.$('chatArea');
  const emptyState = Utils.$('emptyState');

  container.querySelectorAll('.message, .thinking-indicator, .error-indicator, .compaction-indicator, .usage-indicator, .streaming-cursor').forEach(m => m.remove());
  Chat.Streaming.resetAccum();

  const msgList = (messages && (messages.value || messages)) || [];
  if (msgList.length === 0) {
    emptyState.classList.add('active');
    if (window.Chain && window.Chain.beginRebuild) window.Chain.beginRebuild();
    return;
  }

  emptyState.classList.remove('active');

  // Batch all bubbles into a single fragment so the browser performs one
  // layout/paint instead of one forced reflow per message (scrollTop reads).
  const fragment = document.createDocumentFragment();
  if (window.Chain && window.Chain.beginRebuild) window.Chain.beginRebuild();
  for (const msg of msgList) {
    const role = msg.info ? msg.info.role : 'assistant';
    const id = msg.info ? msg.info.id : null;
    if (msg.parts) {
      for (const part of msg.parts) {
        if (part.type === 'text' && part.text) {
          // Skip auto-compaction continuation messages (official OpenCode flag)
          if (part.metadata && part.metadata.compaction_continue) {
            continue;
          }
          if (part.synthetic) {
            continue;
          }
          fragment.appendChild(createMessageElement(role, part.text, id));
        } else if (part.type === 'reasoning' || part.type === 'tool') {
          if (window.Chain && window.Chain.rebuildPart) {
            window.Chain.rebuildPart(part, fragment);
          }
        }
      }
    }
  }

  container.appendChild(fragment);
  if (window.Chain && window.Chain.endRebuild) window.Chain.endRebuild();
  container.scrollTop = container.scrollHeight;
}

/** Build a single message bubble element (no DOM insertion / scroll). */
function createMessageElement(role, text, messageId = null) {
  const msg = document.createElement('div');
  msg.className = 'message ' + (role === 'user' ? 'user-message' : 'ai-message');
  if (messageId) msg.dataset.messageId = messageId;

  if (role === 'user') {
    msg.innerHTML = '<div class="msg-card"><div class="msg-card-text">' + escapeHtml(text) + '</div><textarea class="msg-edit-textarea">' + escapeHtml(text) + '</textarea></div>';
    if (messageId) {
      const revertBtn = document.createElement('button');
      revertBtn.className = 'msg-revert-btn';
      revertBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10h10a5 5 0 0 1 0 10H9"/><polyline points="7 14 3 10 7 6"/></svg>';
      revertBtn.title = 'Revert to this point';
      revertBtn.addEventListener('click', () => window.Revert.startEditMode(messageId, text, msg));
      msg.appendChild(revertBtn);

      const sendBtn = document.createElement('button');
      sendBtn.className = 'msg-send-btn';
      sendBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
      sendBtn.title = 'Revert and send';
      sendBtn.addEventListener('click', () => window.Revert.executeInlineRevert(messageId, msg));
      msg.appendChild(sendBtn);
    }
  } else {
    renderTextContent(msg, text);
  }

  return msg;
}

/** Append a single message bubble to the chat area. */
function appendMessage(role, text, messageId = null) {
  const container = Utils.$('chatArea');
  if (!container) return null;
  const emptyState = Utils.$('emptyState');
  if (emptyState) emptyState.classList.remove('active');

  const msg = createMessageElement(role, text, messageId);
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
  return msg;
}

/** Render inline markdown: bold, italic, inline code, and line breaks. */
function renderInlineMarkdown(text) {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
  s = s.replace(/\n/g, '<br>');
  return s;
}

/** Render message text with fenced code blocks and diff highlighting. */
function renderTextContent(container, text) {
  const regex = /```(\w+)?\n([\s\S]*?)(?:```|$)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const beforeCode = text.slice(lastIndex, match.index);
    if (beforeCode.trim()) {
      const span = document.createElement('span');
      span.className = 'msg-text';
      span.innerHTML = renderInlineMarkdown(beforeCode);
      container.appendChild(span);
    }

    const code = match[2];
    const pre = document.createElement('pre');
    const codeEl = document.createElement('code');

    const lines = code.split('\n');
    for (const line of lines) {
      const lineDiv = document.createElement('div');
      lineDiv.className = 'code-line';

      if (line.startsWith('+')) {
        lineDiv.classList.add('diff-add');
        lineDiv.textContent = line;
      } else if (line.startsWith('-')) {
        lineDiv.classList.add('diff-remove');
        lineDiv.textContent = line;
      } else if (line.startsWith('@@')) {
        lineDiv.classList.add('diff-context');
        lineDiv.textContent = line;
      } else {
        lineDiv.textContent = line;
      }

      codeEl.appendChild(lineDiv);
    }

    pre.appendChild(codeEl);
    container.appendChild(pre);
    lastIndex = match.index + match[0].length;
  }

  const remaining = text.slice(lastIndex);
  if (remaining.trim()) {
    const span = document.createElement('span');
    span.className = 'msg-text';
    span.innerHTML = renderInlineMarkdown(remaining);
    container.appendChild(span);
  }
}

window.Chat = window.Chat || {};
window.Chat.Messages = { renderMessages, appendMessage, createMessageElement, renderTextContent, renderInlineMarkdown };
