const normalizeIndianPhone = (input) => {
  if (!input) return null;
  let digits = String(input).replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }
  if (digits.length === 12 && digits.startsWith("91")) {
    digits = digits.slice(2);
  }
  if (digits.length !== 10) {
    return null;
  }
  if (!/^[6-9]\d{9}$/.test(digits)) {
    return null;
  }
  return `+91${digits}`;
};
export { normalizeIndianPhone };
