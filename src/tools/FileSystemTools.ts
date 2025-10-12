
import { z } from 'zod';
import * as fs from 'fs/promises';
import type { McpTool } from '../schemas/tools/index.js';

const ReadFileSchema = z.object({
  absolute_path: z.string().describe('The absolute path to the file to read.'),
});

const WriteFileSchema = z.object({
  absolute_path: z.string().describe('The absolute path to the file to write.'),
  content: z.string().describe('The content to write to the file.'),
});

export class FileSystemTools {
  constructor() {}

  getTools(): McpTool[] {
    return [
      {
        name: 'read_file',
        description: 'Reads the content of a file at a given absolute path.',
        inputSchema: ReadFileSchema,
        handler: async (args: z.infer<typeof ReadFileSchema>) => {
          const { absolute_path } = args;
          try {
            const content = await fs.readFile(absolute_path, 'utf-8');
            return { success: true, content };
          } catch (error: any) {
            if (error.code === 'ENOENT') {
              return { success: false, error: `File not found at ${absolute_path}` };
            }
            return { success: false, error: `Could not read file ${absolute_path}. ${error.message}` };
          }
        },
      },
      {
        name: 'write_file',
        description: 'Writes content to a file at a given absolute path. Creates the file if it doesn\'t exist, overwrites if it does.',
        inputSchema: WriteFileSchema,
        handler: async (args: z.infer<typeof WriteFileSchema>) => {
          const { absolute_path, content } = args;
          try {
            await fs.writeFile(absolute_path, content, 'utf-8');
            return { success: true, message: `Successfully wrote ${content.length} bytes to ${absolute_path}` };
          } catch (error: any) {
            return { success: false, error: `Could not write file ${absolute_path}. ${error.message}` };
          }
        },
      },
    ];
  }
}
