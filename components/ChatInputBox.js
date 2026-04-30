// components/ChatInputBox.js
// Animated glassmorphism input box for the Ask Question chat page.
// Adapted from the AnimatedAIChat component (TypeScript/Tailwind → JS/CSS Modules).
// Framer Motion handles all entrance and interaction animations.

import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Loader2 } from "lucide-react";
import styles from "../styles/ChatInputBox.module.css";

// ── Auto-resize textarea hook ──────────────────────────────────────────────
function useAutoResize({ minHeight = 44, maxHeight = 160 } = {}) {
  const ref = useRef(null);

  const adjust = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = `${minHeight}px`;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, [minHeight, maxHeight]);

  useEffect(() => {
    if (ref.current) ref.current.style.height = `${minHeight}px`;
  }, [minHeight]);

  useEffect(() => {
    window.addEventListener("resize", adjust);
    return () => window.removeEventListener("resize", adjust);
  }, [adjust]);

  return { ref, adjust };
}

// ── TypingDots ─────────────────────────────────────────────────────────────
function TypingDots() {
  return (
    <span className={styles.typingDots} aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className={styles.typingDot}
          initial={{ opacity: 0.3, scale: 0.85 }}
          animate={{ opacity: [0.3, 0.9, 0.3], scale: [0.85, 1.1, 0.85] }}
          transition={{
            duration: 1.2,
            repeat: Infinity,
            delay: i * 0.15,
            ease: "easeInOut",
          }}
        />
      ))}
    </span>
  );
}

// ── ChatInputBox ───────────────────────────────────────────────────────────
// Props:
//   value        – controlled input string
//   onChange     – (e) => void   – called on textarea change
//   onSend       – () => void    – called to submit the message
//   loading      – bool          – shows spinner, disables send
//   disabled     – bool          – atLimit / other disables
//   placeholder  – string
//
// The component forwards its ref to the internal <textarea> so the parent
// can call .focus() after sends or mode switches.

const ChatInputBox = forwardRef(function ChatInputBox(
  { value, onChange, onSend, loading = false, disabled = false, placeholder = "Ask a question…" },
  forwardedRef,
) {
  const [focused, setFocused] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const { ref: internalRef, adjust } = useAutoResize({ minHeight: 44, maxHeight: 160 });

  // Merge forwarded ref with internal ref
  const setRef = useCallback(
    (el) => {
      internalRef.current = el;
      if (typeof forwardedRef === "function") forwardedRef(el);
      else if (forwardedRef) forwardedRef.current = el;
    },
    [internalRef, forwardedRef],
  );

  // Re-measure whenever value changes
  useEffect(() => {
    adjust();
  }, [value, adjust]);

  // Track mouse only while focused (drives the glow orb)
  useEffect(() => {
    if (!focused) return;
    const handler = (e) => setMousePos({ x: e.clientX, y: e.clientY });
    window.addEventListener("mousemove", handler);
    return () => window.removeEventListener("mousemove", handler);
  }, [focused]);

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !loading && !disabled) onSend();
    }
  }

  const canSend = Boolean(value.trim()) && !loading && !disabled;

  return (
    <>
      {/* Mouse-following glow — visible only in dark mode when focused */}
      <AnimatePresence>
        {focused && (
          <motion.div
            className={styles.focusGlow}
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{
              opacity: 1,
              x: mousePos.x - 200,
              y: mousePos.y - 200,
            }}
            exit={{ opacity: 0 }}
            transition={{
              opacity: { duration: 0.3 },
              x: { type: "spring", damping: 28, stiffness: 160, mass: 0.5 },
              y: { type: "spring", damping: 28, stiffness: 160, mass: 0.5 },
            }}
          />
        )}
      </AnimatePresence>

      {/* Main input card */}
      <motion.div
        className={`${styles.inputBox} ${focused ? styles.inputBoxFocused : ""}`}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* Textarea */}
        <div className={styles.textareaWrap}>
          <textarea
            ref={setRef}
            className={styles.textarea}
            value={value}
            onChange={(e) => {
              onChange(e);
              adjust();
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={placeholder}
            disabled={disabled || loading}
            aria-label="Chat input"
            rows={1}
            style={{ overflow: "hidden" }}
          />
        </div>

        {/* Toolbar */}
        <div className={styles.toolbar}>
          {/* Loading status — shown inline in the toolbar */}
          <AnimatePresence mode="wait">
            {loading ? (
              <motion.span
                key="thinking"
                className={styles.thinkingLabel}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -6 }}
                transition={{ duration: 0.2 }}
              >
                Thinking <TypingDots />
              </motion.span>
            ) : (
              <motion.span
                key="hint"
                className={styles.hint}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                Enter to send · Shift+Enter for new line
              </motion.span>
            )}
          </AnimatePresence>

          {/* Send button */}
          <motion.button
            type="button"
            onClick={onSend}
            disabled={!canSend}
            whileHover={canSend ? { scale: 1.04 } : {}}
            whileTap={canSend ? { scale: 0.96 } : {}}
            className={`${styles.sendBtn} ${canSend ? styles.sendBtnActive : styles.sendBtnMuted}`}
            aria-label="Send message"
          >
            {loading ? (
              <Loader2 size={15} className={styles.spinnerIcon} />
            ) : (
              <Send size={15} />
            )}
            <span>Send</span>
          </motion.button>
        </div>
      </motion.div>
    </>
  );
});

export default ChatInputBox;
