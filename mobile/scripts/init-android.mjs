import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const root=resolve(import.meta.dirname,'..');
const activity=resolve(root,'android/app/src/main/java/com/ravirgo/flowad/MainActivity.java');
const native=resolve(root,'android/app/src/main/java/com/ravirgo/flowad/FlowadNavigationPlugin.java');
if(!existsSync(activity)){
  const result=spawnSync(process.platform==='win32'?'npx.cmd':'npx',['cap','add','android'],{cwd:root,stdio:'inherit'});
  if(result.status!==0)process.exit(result.status||1);
}
if(!existsSync(activity))throw new Error('Generated MainActivity not found at '+activity);
mkdirSync(dirname(native),{recursive:true});
copyFileSync(resolve(root,'native/FlowadNavigationPlugin.java'),native);
let content=readFileSync(activity,'utf8');
if(!content.includes('registerPlugin(FlowadNavigationPlugin.class)')){
  if(!content.includes('public class MainActivity extends BridgeActivity'))throw new Error('Unsupported MainActivity template');
  content=content.replace('public class MainActivity extends BridgeActivity {',
    'public class MainActivity extends BridgeActivity {\n  @Override public void onCreate(android.os.Bundle state) {\n    registerPlugin(FlowadNavigationPlugin.class);\n    super.onCreate(state);\n  }');
  writeFileSync(activity,content);
}
console.log('Android Stage 3 scaffold ready. Native Bridge registered; no vehicle commands are implemented.');
