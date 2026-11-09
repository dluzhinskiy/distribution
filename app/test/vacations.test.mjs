import test from "node:test";
import assert from "node:assert/strict";
import { allDatesInRange, replaceVacationDatesForEmployees, replaceVacationYear, setVacationDates, upcomingVacation, vacationDatesForEmployee, workingDaysInRange } from "../lib/vacations.mjs";
import { parseMonthlyVacationRows } from "../lib/xlsx-vacation-import.mjs";
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

test("upcoming vacation warns two calendar days before and counts weekdays", () => {
  const employee = { employee_id: "E-1", [FIELD.name]: "Иванов Иван" };
  const vacations = [{ employee_id: "E-1", "Дата начала": "2026-07-29", "Дата окончания": "2026-08-03" }];
  const upcoming = upcomingVacation(employee, new Date(2026, 6, 27, 12), vacations, 2);
  assert.deepEqual(upcoming, {
    start: "2026-07-29",
    end: "2026-08-03",
    daysUntil: 2,
    workingDays: 4,
  });
  assert.equal(workingDaysInRange("2026-07-29", "2026-08-03"), 4);
  assert.equal(workingDaysInRange("2026-11-02", "2026-11-06"), 4);
  assert.equal(workingDaysInRange("2026-12-28", "2026-12-31"), 3);
  assert.equal(upcomingVacation(employee, new Date(2026, 6, 26, 12), vacations, 2), null);
});

test("monthly colored vacation grid reads highlighted dates under month headers", () => {
  const january = ["Январь 2026"];
  const employee = ["Иванов Иван Иванович", 1, 2, 3, 4];
  employee.cellStyles = [0, 4, 5, 5, 4];
  const parsed = parseMonthlyVacationRows([january, employee], new Map([
    [4, { pattern: "solid", rgb: "FFFFFFFF", theme: "" }],
    [5, { pattern: "solid", rgb: "FFFFAAFF", theme: "" }],
  ]));
  assert.equal(parsed.scopeDates.length, 31);
  assert.deepEqual(parsed.sourceRows[0].vacationDates, ["2026-01-02", "2026-01-03"]);
});

test("vacation import replaces the full file period including past days and preserves absent employees", () => {
  const data = {
    employees: [
      { employee_id: "e1", "ФИО": "Иванов Иван Иванович" },
      { employee_id: "e2", "ФИО": "Петров Петр Петрович" },
    ],
    vacations: [
      { employee_id: "e1", "ФИО": "Иванов Иван Иванович", "Дата начала": "2026-01-05", "Дата окончания": "2026-01-06" },
      { employee_id: "e1", "ФИО": "Иванов Иван Иванович", "Дата начала": "2027-02-01", "Дата окончания": "2027-02-02" },
      { employee_id: "e2", "ФИО": "Петров Петр Петрович", "Дата начала": "2026-03-10", "Дата окончания": "2026-03-11" },
    ],
  };
  const scopeDates = allDatesInRange("2026-01-01", "2026-12-31");
  replaceVacationDatesForEmployees(data, [{ employee_id: "e1", vacationDates: ["2026-09-14"] }], scopeDates);
  assert.deepEqual(vacationDatesForEmployee(data.vacations, "e1", 2026), ["2026-09-14"]);
  assert.deepEqual(vacationDatesForEmployee(data.vacations, "e1", 2027), ["2027-02-01", "2027-02-02"]);
  assert.deepEqual(vacationDatesForEmployee(data.vacations, "e2", 2026), ["2026-03-10", "2026-03-11"]);
});
