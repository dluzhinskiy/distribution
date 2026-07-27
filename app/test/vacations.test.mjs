import test from "node:test";
import assert from "node:assert/strict";
import { allDatesInRange, replaceVacationYear, setVacationDates, vacationDatesForEmployee } from "../lib/vacations.mjs";
import { FIELD } from "../lib/domain-schema.mjs";

function fixture() {
  return {
    employees: [{ employee_id: "E-1", [FIELD.name]: "Иванов Иван" }],
    vacations: [],
  };
}

test("vacation ranges normalize direction and compress adjacent dates", () => {
  assert.deepEqual(allDatesInRange("2026-07-03", "2026-07-01"), ["2026-07-01", "2026-07-02", "2026-07-03"]);
  const data = fixture();
  replaceVacationYear(data, "E-1", 2026, ["2026-08-01", "2026-08-02", "2026-08-04"]);
  assert.equal(data.vacations.length, 2);
  assert.deepEqual(vacationDatesForEmployee(data.vacations, "E-1", 2026), ["2026-08-01", "2026-08-02", "2026-08-04"]);
});

test("vacation toggle changes only selected dates", () => {
  const data = fixture();
  replaceVacationYear(data, "E-1", 2026, ["2026-08-01", "2026-08-02"]);
  setVacationDates(data, "E-1", ["2026-08-02"], false);
  assert.deepEqual(vacationDatesForEmployee(data.vacations, "E-1", 2026), ["2026-08-01"]);
  setVacationDates(data, "E-1", ["2026-08-03"], true);
  assert.deepEqual(vacationDatesForEmployee(data.vacations, "E-1", 2026), ["2026-08-01", "2026-08-03"]);
});
