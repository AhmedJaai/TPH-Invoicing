/** قيمُ نموذج الموظّف — نصوصٌ كما تُكتب، والخادمُ يفحصها ويحوّلها. */
export interface EmployeeFormValues {
  id?: string;
  name: string;
  kind: "MONTHLY" | "PART_TIME";
  jobTitle: string;
  phone: string;
  nationalId: string;
  bankBeneficiaryId: string;
  iban: string;
  hiredOn: string;
  leftOn: string;
  shiftStart: string;
  /** نهايةُ الدوام «HH:MM» — والطولُ يحسبه الخادم منها ومن البداية. */
  shiftEnd: string;
  lateGraceMinutes: string;
  daysOff: string;
  note: string;
  salary?: string;
}

export const BLANK_EMPLOYEE: EmployeeFormValues = {
  name: "", kind: "MONTHLY", jobTitle: "", phone: "", nationalId: "", bankBeneficiaryId: "", iban: "",
  hiredOn: "", leftOn: "", shiftStart: "", shiftEnd: "", lateGraceMinutes: "0", daysOff: "", note: "", salary: "",
};
