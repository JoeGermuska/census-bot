// components/ShimmerText.js
// Static title — no shimmer / wavy color animation.
import styles from "../styles/ShimmerText.module.css";

export default function ShimmerText({ children, style, className }) {
  return (
    <span
      className={`${styles.root}${className ? ` ${className}` : ""}`}
      style={style}
    >
      {children}
    </span>
  );
}
