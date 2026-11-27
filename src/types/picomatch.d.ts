/** picomatch كما يحمله Next داخلَه — به يطابق مفاتيحَ `outputFileTracingIncludes`، فيُختبر بالمكتبة نفسها. */
declare module "next/dist/compiled/picomatch" {
  const picomatch: (glob: string) => (input: string) => boolean;
  export default picomatch;
}
