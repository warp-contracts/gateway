RedStone Gateway - a fast and reliable portal to Arweave SmartWeave interaction transactions.

- fast - load your contract interactions in seconds, not minutes!
- safe - built-in protection against forks and orphaned transactions
- reliable - protection against random quirks (like same transactions repeated multiple times) from base Arweave
  gateways

### Reasoning

SmartWeave is an Arweave-based protocol for lazy-evaluated smart contracts. Each interaction with contract is saved as a
separate Arweave transaction. In order to evaluate the contract state, all of its interactions must be loaded first. The
current available solution ("general-purpose" Arweave gateway)
has some flaws:

1. It is slow. The interactions can be loaded using the GQL endpoint, which can return only 100 interactions in a single
   batch/query. At the time of writing, each query takes around from 300ms to 5 seconds. For
   our "loot" contract (that has 9821 interactions) it means that loading all the contract interactions takes around 1 minute.  
   There are contracts with much more interactions - the biggest one has over 280000 interactions - loading all the
   interactions would for this contract takes ~3 hours. This clearly shows that current solution
   scales poorly and is a first big obstacle for a wider SmartWeave contracts adoption.

2. The Arweave gateway GQL endpoint tends to return orphaned transactions - i.e. such transactions, that are not part of
   any Arweave block - probably due to some caching issues/bug in the Arweave
   gateway (https://discord.com/channels/357957786904166400/756557551234973696/891254856638160917)
   The state evaluated with such orphaned transactions is obviously flawed. In case of our loot contract - 25
   transactions returned by the Arweave gateway are orphaned.

3. No protection against transactions from forked blocks.

All the above issues are a big obstacle in a wider SmartWeave contracts adoption. It also makes things like caching the
contract state very risky - as you have very little guarantee that the state has been evaluated for proper inputs.

### Our solution

We're combining data from both the Arweave Gateway and the Arweave peers directly, perform transactions validation,
store and index them in a dedicated database.
![gateway](./docs/gateway.png)

The RedStone Gateway consists of three main tasks:

1. The Sync Arweave Peers Task - this task is responsible for loading information about currently active peers and rank
   them by the amount of synced blocks and response times.
2. The Sync Blocks Task - this task is responsible for loading and indexing SmartWeave interaction transactions from the
   newly mined blocks
3. Confirm Transactions Task - the most complicated task, responsible for confirming transactions.

   - It takes the first PARALLEL_REQUESTS, non-confirmed transactions with block height lower than current -
     MIN_CONFIRMATIONS.
   - For each set of the selected 'interactionsToCheck' transactions it makes TX_CONFIRMATION_SUCCESSFUL_ROUNDS query
     rounds (to randomly selected at each round peers).
   - Only if we get TX_CONFIRMATION_SUCCESSFUL_ROUNDS within TX_CONFIRMATION_MAX_ROUNDS AND response for the given
     transaction is the same for all the successful rounds

   * the "confirmation" info for given transaction in updated in the database.

![confrim interactions tsdk](./docs/conf_task.png) 

### Benchmarks

Tested for block height range: 0 - 831901

| Contract                                    |     Project     | Interactions |   Arweave GW | RedStone GW - 1st. load | RedStone GW - cache |
| ------------------------------------------- | :-------------: | -----------: | -----------: | ----------------------: | ------------------: |
| LkfzZvdl_vfjRXZOPjnov18cGnnK3aDKj0qSQCgkCX8 |      Kyve       |       281129 |  3h 7min 39s |               1 min 27s |                  8s |
| l6S4oMyzw_rggjt4yt4LrnRmggHQ2CdM1hna2MK4o_c |      Kyve       |       194326 | 2h 32min 54s |                     46s |                  6s |
| B1SRLyFzWJjeA0ywW41Qu1j7ZpBLHsXSSrWLrT3ebd8 |      Kyve       |        93098 |    38min 22s |                     16s |                  3s |
| cETTyJQYxJLVQ6nC3VxzsZf1x2-6TW2LFkGZa91gUWc |       Koi       |        22403 |     3min 15s |                      2s |                  1s |
| QA7AIFVx1KBBmzC7WUNhJbDsHlSJArUT0jWrhZMZPS8 |       Koi       |        12228 |     1min 25s |                      1s |               582ms |
| SJ3l7474UHh3Dw6dWVT1bzsJ-8JvOewtGoDdOecWIZo |     Pianity     |        10924 |     1min 13s |                      1s |               670ms |
| NwaSMGCdz6Yu5vNjlMtCNBmfEkjYfT-dfYkbQQDGn5s |       Koi       |        10137 |      1min 5s |                      1s |               491ms |
| Daj-MNSnH55TDfxqC7v4eq0lKzVIwh98srUaWqyuZtY | RedStone - loot |         9821 |      1min 1s |                   834ms |               358ms |
| -8A6RexFkpfWwuyVO98wzSFZh0d6VJuI-buTJvlwOJQ |   ArDrive PST   |         4786 |          20s |                   710ms |               190ms |
| usjm4PCxUd5mtaon7zc97-dt-3qf67yPyqgzLnLqk5A |    Verto PST    |         1041 |           3s |                   459ms |               142ms |

### Orphaned transactions

List of first 15 contracts with the most orphaned transactions. Orphaned transactions are transactions that are not part
of any block - but they are still returned by the Arweave GQL endpoint.
This creates a huge problem when evaluating the state - especially in case of PSTs and `transfer` interactions.

| Contract                                     |     Project     | Orphans |
| -------------------------------------------- | :-------------: | ------: |
| Daj-MNSnH55TDfxqC7v4eq0lKzVIwh98srUaWqyuZtY  | RedStone - loot |      25 |
| -8A6RexFkpfWwuyVO98wzSFZh0d6VJuI-buTJvlwOJQ  |   ArDrive PST   |       9 |
| 1TFZeEewEgUpqT5i2dsZSIRKJq3h1C7ZVi-gE8G-W6U  |     EMD PST     |       8 |
| usjm4PCxUd5mtaon7zc97-dt-3qf67yPyqgzLnLqk5A  |    Verto PST    |       8 |
| wXotIq_fSPvYWR12h6IS-kfD18Y5jkr4UPPp15e0wo0  |       Koi       |       7 |
| NwaSMGCdz6Yu5vNjlMtCNBmfEkjYfT-dfYkbQQDGn5s  |       Koi       |       6 |
| 3NQQlLebRbq32Rtdxf_xaiWCJcQZNmoLvmOxLclGRcU  |      Kyve       |       5 |
| LppT1p3wri4FCKzW5buohsjWxpJHC58_rgIO-rYTMB8  |       Koi       |       5 |
| QA7AIFVx1KBBmzC7WUNhJbDsHlSJArUT0jWrhZMZPS8  |       Koi       |       4 |
| gTT7\_-8nrB1HKyJrPoUiku8-5aL3_wva5BJEn8sUCl4 |       Koi       |       4 |
| SJ3l7474UHh3Dw6dWVT1bzsJ-8JvOewtGoDdOecWIZo  |     Pianity     |       4 |
| K9Lb5WzRHxGyQqZVKL-ckBcnwtEouEBOlphKNmLhHtY  |       Koi       |       4 |
| k-3vYDcwrusBtnouFXh6QlRvwfH57lLvnG8jnf_q1EM  |       Koi       |       4 |
| hFhD2XG0LNKQTo4WCMfhFbD2ssxMn1vOyzwZt0qiJI4  |       Koi       |       3 |
| o-qJmQ4B0d6TnyA_awjhiBdiq0O4Vt_dNWU3pTnhTu8  |    Bones PST    |       2 |

### Further development

1. An option to define the observed contracts - so that each project could run its own instance dedicated to his
   contracts
2. Scale the infrastructure, create backup instances, etc.
3. A form of decentralization with disputes/voting on a challenged responses.
4. Custom network of Arweave nodes, that will listen on and index only SmartWeave interaction transactions (probably
   with the help of the customized Vartex gateway).
5. Even better protection against forks - analyzing blocks history
6. As the amount of data being transferred is rather huge - consider moving from json to protobuf?
7. A fully featured web app that will allow browsing and interacting with contracts

### Installation

1. `yarn install`
2. `yarn build`

### Running

1. Create a file `.secrets/.env` with a `DB_URL` property with PostgreSQL connections string,
   eg: `DB_URL=postgresql://<user>:<password>@<db-host>:<db-port>/<database-name>`

2. Run gateway with `yarn start`.  
   You can pass the `env_path` param with path to the `.env` file, eg:  
   `yarn start:prod --env_path .secrets/.env`

### Running (Docker)

1. build the docker image - run script `docker-build.sh`
2. run the docker image - run script `docker-run.sh`

### HTTP API Reference
