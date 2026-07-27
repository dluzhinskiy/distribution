const ruCompare = new Intl.Collator("ru", { sensitivity: "base", numeric: true }).compare;

export function accessUserLabel(user = {}) {
  return String(user.name || user.employeeId || "").trim();
}

export function groupAccessUsers(users = []) {
  const groups = new Map();
  for (const user of users) {
    const yuc = String(user?.yuc || "").trim();
    if (!groups.has(yuc)) groups.set(yuc, []);
    groups.get(yuc).push(user);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => {
      if (!left) return 1;
      if (!right) return -1;
      return ruCompare(left, right);
    })
    .map(([yuc, groupUsers]) => ({
      yuc,
      label: yuc || "Без ЮЦ",
      users: [...groupUsers].sort((left, right) => (
        ruCompare(accessUserLabel(left), accessUserLabel(right)) ||
        ruCompare(String(left.employeeId || ""), String(right.employeeId || ""))
      )),
    }));
}
