import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const transport = new StdioClientTransport({
    command: "/home/jw/.npm-global/bin/tsx",
    args: ["/home/jw/dev/game1/ZMCPTools/src/index.ts"],
  });

  const client = new Client(
    {
      name: "symbol-extractor",
      version: "1.0.0",
    },
    {
      capabilities: {},
    }
  );

  await client.connect(transport);

  const binDir = path.join(process.cwd(), "talent-os/bin");
  const nuggetsDir = path.join(process.cwd(), "var/cleanup/nuggets");
  fs.mkdirSync(nuggetsDir, { recursive: true});

  const pyFiles = fs
    .readdirSync(binDir)
    .filter((f) => f.endsWith(".py"))
    .sort();

  console.log(`Extracting symbols from ${pyFiles.length} files...`);

  const filesData: any[] = [];
  let totalFuncs = 0;
  let totalClasses = 0;

  for (let i = 0; i < pyFiles.length; i++) {
    const pyFile = pyFiles[i];
    const absPath = path.join(binDir, pyFile);
    const uri = `file://${absPath}/symbols?include_positions=true`;

    try {
      const result: any = await client.request(
        { method: "resources/read", params: { uri } },
        { timeout: 5000 }
      );

      const content = JSON.parse(result.contents[0].text);
      const symbols = content.symbols || [];

      const funcs = symbols.filter((s: any) =>
        s.kind.toLowerCase().includes("function")
      );
      const classes = symbols.filter((s: any) => s.kind === "class");

      const nuggetFile = path.join(
        nuggetsDir,
        pyFile.replace(".py", ".json")
      );
      fs.writeFileSync(nuggetFile, JSON.stringify(content, null, 2));

      filesData.push({
        file: pyFile,
        functions: funcs.length,
        classes: classes.length,
      });

      totalFuncs += funcs.length;
      totalClasses += classes.length;

      if ((i + 1) % 25 === 0) {
        console.log(`  [${i + 1}/${pyFiles.length}] Processed...`);
      }
    } catch (error: any) {
      console.error(`Error processing ${pyFile}:`, error.message);
    }
  }

  const aggregate = {
    date: new Date().toISOString(),
    total_files: filesData.length,
    total_functions: totalFuncs,
    total_classes: totalClasses,
    files: filesData,
  };

  fs.writeFileSync(
    "var/cleanup/nuggets_preserved.json",
    JSON.stringify(aggregate, null, 2)
  );

  fs.writeFileSync(
    "var/cleanup/phase0_complete.md",
    `# Phase 0 Complete\n\n- Files: ${filesData.length}\n- Functions: ${totalFuncs}\n- Classes: ${totalClasses}\n`
  );

  console.log(
    `✅ Phase 0 complete: ${filesData.length} files, ${totalFuncs} functions, ${totalClasses} classes`
  );

  await client.close();
}

main().catch(console.error);
