import { runCli } from '../cli.js';
import { DoctorInput, DoctorOutput } from '../schemas.js';

export async function doctor(input: DoctorInput): Promise<DoctorOutput> {
  const raw = await runCli<unknown>(['doctor', '--json'], {
    cwd: input.cwd,
    allowNonZero: true,
  });
  return DoctorOutput.parse(raw);
}
