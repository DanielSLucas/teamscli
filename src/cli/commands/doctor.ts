import { runDoctor } from '../../auth/doctor.ts';
import type { DoctorCheck } from '../../auth/doctor.ts';
import type { Command } from '../command.ts';
import { secretStore } from '../session.ts';

const command: Command<DoctorCheck[]> = {
  name: 'doctor',
  summary: 'Check the local installation, saved login, and Teams service access',
  mutates: false,
  async run(ctx) {
    return runDoctor({
      account: ctx.account,
      home: ctx.home,
      nodeVersion: process.versions.node,
      fetch: ctx.fetch,
      createSecretStore: () => secretStore(ctx),
      log: ctx.log,
      persistRotation: !ctx.options.readOnly,
    });
  },
};

export default command;
