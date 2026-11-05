import React, { useEffect, useId, useRef } from "react";
import { X, Plus, ArrowUpRight } from "lucide-react";

export function IconButton({ icon: Icon, label, ...props }) {
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={label}
      title={label}
      {...props}
    >
      <Icon size={21} strokeWidth={1.7} />
    </button>
  );
}
export function Button({
  children,
  icon: Icon,
  variant = "primary",
  ...props
}) {
  return (
    <button type="button" className={`button ${variant}`} {...props}>
      {Icon && <Icon size={18} strokeWidth={1.8} />}
      {children}
    </button>
  );
}
export function SectionTitle({ title, subtitle, action, onAction }) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action && (
        <button className="text-button" onClick={onAction}>
          {action}
          <ArrowUpRight size={15} />
        </button>
      )}
    </div>
  );
}
export function Empty({
  icon: Icon,
  title,
  text,
  action,
  onAction,
  compact = false,
}) {
  return (
    <div className={`empty ${compact ? "compact" : ""}`}>
      <span className="empty-icon">
        <Icon size={25} strokeWidth={1.4} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action && (
        <Button variant="secondary" icon={Plus} onClick={onAction}>
          {action}
        </Button>
      )}
    </div>
  );
}
export function Field({ label, children, hint }) {
  const id = useId();
  const nativePicker =
    React.isValidElement(children) &&
    children.type === "input" &&
    ["date", "time"].includes(children.props.type);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {React.isValidElement(children)
        ? React.cloneElement(children, {
            id,
            ...(hint ? { "aria-describedby": `${id}-hint` } : {}),
            ...(nativePicker ? { onInput: children.props.onChange } : {}),
          })
        : children}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}
export function Segmented({ values, value, onChange, label }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {values.map((item) => (
        <button
          key={item}
          aria-pressed={value === item}
          className={value === item ? "selected" : ""}
          onClick={() => onChange(item)}
        >
          {item}
        </button>
      ))}
    </div>
  );
}
export function Sheet({ title, subtitle, children, onClose, wide = false }) {
  const ref = useRef(null),
    titleId = useId();
  useEffect(() => {
    const previous = document.activeElement;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const element = ref.current;
    const focusable = () =>
      [
        ...element.querySelectorAll(
          'button,input,select,textarea,a[href],[tabindex="0"]',
        ),
      ].filter((e) => !e.disabled && e.offsetParent !== null);
    (
      focusable().find((e) => e.tagName === "INPUT") ||
      focusable()[0] ||
      element
    ).focus();
    const handleKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (e.key !== "Tab") return;
      const elements = focusable(),
        first = elements[0],
        last = elements.at(-1);
      if (!first) {
        e.preventDefault();
        return;
      }
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    element.addEventListener("keydown", handleKey);
    return () => {
      element.removeEventListener("keydown", handleKey);
      document.body.style.overflow = oldOverflow;
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="sheet-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={ref}
        tabIndex={-1}
        className={`sheet ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="sheet-handle" />
        <header className="sheet-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <IconButton icon={X} label="Close" onClick={onClose} />
        </header>
        <div className="sheet-body">{children}</div>
      </section>
    </div>
  );
}
export function Confirm({
  title,
  text,
  action = "Delete",
  onConfirm,
  onClose,
}) {
  return (
    <Sheet title={title} onClose={onClose}>
      <p className="confirm-text">{text}</p>
      <div className="form-actions">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" onClick={onConfirm}>
          {action}
        </Button>
      </div>
    </Sheet>
  );
}
export function ArabicText({ text, className = "", ...props }) {
  return (
    <span dir="auto" className={`mixed ${className}`} {...props}>
      {text}
    </span>
  );
}
