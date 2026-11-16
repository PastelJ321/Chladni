import { useEffect, useState } from 'react';
export function NumberField({
  label,
  value,
  onChange,
  unit = '',
  step = 1,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
}) {
  const [text, setText] = useState(String(+value.toPrecision(8)));
  useEffect(() => setText(String(+value.toPrecision(8))), [value]);
  const commit = () => {
    const n = Number(text);
    if (text.trim() && Number.isFinite(n) && n !== +value.toPrecision(8)) onChange(n);
    setText(String(+value.toPrecision(8)));
  };
  return (
    <label className="number-field">
      <span>{label}</span>
      <div>
        <input
          aria-label={label}
          type="number"
          value={text}
          step={step}
          min={min}
          max={max}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        <small>{unit}</small>
      </div>
    </label>
  );
}
export function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  options: [string | number, string][];
}) {
  return (
    <label className="select-field">
      <span>{label}</span>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}
