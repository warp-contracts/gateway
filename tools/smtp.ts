/* eslint-disable */
import { LoggerFactory } from 'warp-contracts';
import { client } from '../src/nodemailer/config';

async function main() {
  const logger = LoggerFactory.INST.create('smtp');

  require('dotenv').config({
    path: '.secrets/prod.env',
  });

  try {
    const mailClient = client();

    mailClient.sendMail({
      from: 'notifications@warp.cc',
      to: 'asia@warp.cc',
      subject: `Test SMTP mail.`,
      text: `Testing SMTP.`,
    });
  } catch (e) {
    logger.error(e);
  }
}

main().catch((e) => console.error(e));
