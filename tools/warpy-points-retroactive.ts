import { Tag, WarpFactory, WriteInteractionResponse } from 'warp-contracts';
import { DatabaseSource } from '../src/db/databaseSource';
import fs from 'fs';

async function main() {
  require('dotenv').config({
    path: '.secrets/prod.env',
  });

  const warp = WarpFactory.forMainnet().useGwUrl('https://gw.warp.cc');
  const wallet = JSON.parse(
    fs.readFileSync('.secrets/warp-wallet-jwk.json', 'utf-8')
  );
  const contract = warp
    .contract('p5OI99-BaY4QbZts266T7EDwofZqs-wVuYJmMCS0SUU')
    .connect(wallet)
    .setEvaluationOptions({ sequencerUrl: 'https://gw.warp.cc' });

  const points = Number(process.argv[2]);

  const dbSource = new DatabaseSource([
    {
      client: 'pg',
      url: process.env.DB_URL_GCP as string,
      ssl: {
        rejectUnauthorized: false,
        ca: fs.readFileSync('.secrets/prod-ca.pem'),
        cert: fs.readFileSync('.secrets/prod-cert.pem'),
        key: fs.readFileSync('.secrets/prod-key.pem'),
      },
      primaryDb: true,
    },
  ]);

  // set temporary table
  await dbSource.raw(
    `
                            create table w2_temp as (
                                select interaction_id as interaction_id,
                                tags ->> 'value' as input,
                                false as updated
                                from interactions, jsonb_array_elements(interaction -> 'tags') tags,
                                jsonb_array_elements((tags ->> 'value')::jsonb -> 'members') members
                                where contract_id = 'p5OI99-BaY4QbZts266T7EDwofZqs-wVuYJmMCS0SUU'
                                and function = 'addPointsForAddress'
                                and tags ->> 'name' = 'Input'
                                and members ->> 'txId' is not null
                                and ((tags ->> 'value')::jsonb ->> 'points')::int = ?);
                                `,
    [points]
  );

  let allUpdated = false;

  while (!allUpdated) {
    const result = await dbSource.raw(`
                  select input, interaction_id from w2_temp where not updated limit 10;
                `);

    if (result.rows.length == 0) {
      allUpdated = true;
      console.log('All rows updated. Exiting loop.');
      break;
    }

    console.log('Found new records: ', result.rows.length);

    const members: { id: string; roles: string[]; txId: string }[] = [];

    result.rows.forEach((r: { input: string; interaction_id: string }) => {
      const member = JSON.parse(r.input).members[0];
      delete member.txId;
      members.push(member);
    });

    const interaction = {
      function: 'addPointsForAddress',
      points: -(points - 50),
      adminId: '769844280767807520',
      members,
      noBoost: false,
    };

    const { originalTxId } = (await contract.writeInteraction(interaction, {
      tags: [new Tag('Avalanche-Syncer', 'Retroactive_Subtraction_2023_01_30')],
    })) as WriteInteractionResponse;

    console.log('New interaction sent to Warpy: ', originalTxId);

    await dbSource.raw(
      `
                    update w2_temp set updated = true where interaction_id in (${result.rows
                      .map(
                        (r: { input: string; interaction_id: string }) =>
                          `'${r.interaction_id}'`
                      )
                      .join(',')});
                    `
    );

    console.log('Interactions updated status set to true');
  }

  process.exit(0);
}

main().catch((e) => console.error(e));
