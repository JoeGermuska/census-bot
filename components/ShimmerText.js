// components/ShimmerText.js
// Gradient is owned entirely by CSS (ShimmerText.module.css).
// Framer Motion only animates backgroundPositionX — nothing else.
// Theme switching changes background-image via the CSS class rule, which
// does NOT reset background-position-x, so the shimmer sweep continues
// uninterrupted across theme toggles with no React re-renders involved.

import { motion } from "framer-motion";
import styles from "../styles/ShimmerText.module.css";

export default function ShimmerText({
  children,
  duration = 2.4,
  delay = 1.0,
  repeatDelay = 3.0,
  style,
  className,
}) {
  return (
    <motion.span
      className={`${styles.root}${className ? ` ${className}` : ""}`}
      style={style}
      initial={{ backgroundPositionX: "100%" }}
      animate={{ backgroundPositionX: "0%" }}
      transition={{
        duration,
        delay,
        repeat: Infinity,
        repeatDelay,
        ease: "linear",
      }}
    >
      {children}
    </motion.span>
  );
}
