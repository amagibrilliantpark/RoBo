/** Global application state shared across all renderer modules. */
window.App = {
  currentSession: null,
  isProcessing: false,
  sessions: [],
  providers: [],
  agents: [],
  currentAgent: 'build',
  currentModel: null,
  currentVariant: 'high',
  currentSessionTokens: null,
  // Set by stopGeneration() right before /abort is sent. Cleared in
  // handleMessageUpdated once the trailing message.updated(completed=true)
  // arrives, so the chat can show "Generation stopped by user" once.
  abortedByUser: false,
  debug: false
};
