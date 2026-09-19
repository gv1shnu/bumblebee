import { homedir } from 'node:os'
import { join } from 'node:path'
import { CorpusDb } from '../main/db'
import { Ingestor } from '../main/ingest'

const file=process.argv[2];if(!file){console.error('usage: npm run ingest -- <file-or-folder>');process.exit(2)}
const userData=process.env.BUMBLEBEE_DATA_DIR||join(homedir(),'Library','Application Support','Bumblebee Radio')
const db=new CorpusDb(join(userData,'corpus.db'));const ingestor=new Ingestor(db.db,userData,p=>{console.log(`[${p.stage}] ${p.pct}% ${p.message}`);if(p.stage==='done'||p.stage==='error'){db.db.close();process.exitCode=p.stage==='error'?1:0}});await ingestor.start([file])
