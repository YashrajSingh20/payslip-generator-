import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { renderPayslipPdf } from '../src/payroll/pdf.js';
import { DEMO_PAYSLIP, DEMO_RUN } from '../../app/lib/demo-payslip.js';

const bytes = await renderPayslipPdf(DEMO_PAYSLIP, DEMO_RUN);
const publicDir = new URL('../../public/demo/', import.meta.url);
const outputDir = new URL('../../output/pdf/', import.meta.url);
await mkdir(publicDir, { recursive: true });
await mkdir(outputDir, { recursive: true });
await writeFile(new URL('payslip.pdf', publicDir), bytes);
await writeFile(new URL('payslips.zip', publicDir), zipSync({ [DEMO_PAYSLIP.fileName]: bytes }));
const output = new URL(DEMO_PAYSLIP.fileName, outputDir);
await writeFile(output, bytes);
console.log(fileURLToPath(output));
