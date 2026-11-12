import test from "node:test";
import assert from "node:assert/strict";
import { groupAccessUsers } from "../public/lib/access-utils.js";

test("access users are grouped by YUC and sorted alphabetically", () => {
  const groups = groupAccessUsers([
    { employeeId: "3", name: "Яковлев", yuc: "ЮЦ Юг" },
    { employeeId: "2", name: "Петров", yuc: "ЮЦ Север" },
    { employeeId: "1", name: "Антонов", yuc: "ЮЦ Север" },
    { employeeId: "4", name: "Без центра", yuc: "" },
  ]);
  assert.deepEqual(groups.map((group) => group.label), ["ЮЦ Север", "ЮЦ Юг", "Без ЮЦ"]);
  assert.deepEqual(groups[0].users.map((user) => user.name), ["Антонов", "Петров"]);
});
