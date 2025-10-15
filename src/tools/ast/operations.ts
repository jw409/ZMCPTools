import { TreeSitterASTTool } from '../TreeSitterASTTool.js';
import { ASTParseResult, ASTToolArgs } from '../../types/ast.js';

export async function parse(tool: TreeSitterASTTool, args: ASTToolArgs, parseResult: ASTParseResult) {
    if (parseResult.language === "python" && !parseResult.tree.rootNode) {
        const structure = tool.buildPythonStructureFromSymbols(parseResult.tree.symbols);
        return {
            success: true,
            language: "python",
            structure,
            symbols: parseResult.tree.symbols,
            errors: parseResult.errors,
        };
    }

    if (!parseResult.tree.rootNode) {
        return {
            success: false,
            error: `No AST root node available for ${parseResult.language}`,
            errors: parseResult.errors,
        };
    }

    let compactTree = tool.createCompactTree(parseResult.tree.rootNode, parseResult.language);
    if (args.max_depth) {
        compactTree = tool.applyDepthLimit(compactTree, args.max_depth);
    }
    if (args.omit_redundant_text !== false) {
        compactTree = tool.omitRedundantText(compactTree);
    }

    const result2 = {
        success: true,
        language: parseResult.language,
        errors: parseResult.errors,
    };

    if (args.use_symbol_table !== false) {
        const { tree, symbolTable } = tool.buildSymbolTable(compactTree);
        result2.compactTree = tree;
        result2.symbolTable = symbolTable;
        result2.optimization = {
            symbol_table_size: Object.keys(symbolTable).length,
            estimated_token_reduction: `${Math.min(Object.keys(symbolTable).length * 3, 50)}%`,
        };
    } else {
        result2.compactTree = compactTree;
    }

    if (args.include_semantic_hash) {
        result2.semantic_hash = tool.generateSemanticHash(compactTree);
    }

    if (args.compact || args.use_symbol_table) {
        result2.structure = tool.getFileStructure(parseResult.tree, parseResult.language);
    } else {
        result2.ast = tool.simplifyAST(parseResult.tree.rootNode);
    }

    return result2;
}
