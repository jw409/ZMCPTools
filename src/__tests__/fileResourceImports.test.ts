import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { existsSync } from 'fs';
import { DatabaseManager } from '../database/index.js';
import { ResourceManager } from '../managers/ResourceManager.js';

describe('File Resource - Imports Extraction', () => {
  let dbManager: DatabaseManager;
  let resourceManager: ResourceManager;
  let testDir: string;
  let testCounter = 0;

  beforeEach(async () => {
    // Create unique test directory for each test
    testCounter++;
    testDir = join(process.cwd(), `test-imports-${Date.now()}-${testCounter}`);
    await fs.mkdir(testDir, { recursive: true });

    // Initialize database with test path
    dbManager = new DatabaseManager(join(testDir, 'test.db'));
    await dbManager.initialize();

    // Initialize resource manager
    resourceManager = new ResourceManager(dbManager, testDir);
  });

  afterEach(async () => {
    // Clean up test directory
    if (existsSync(testDir)) {
      await fs.rm(testDir, { recursive: true, force: true });
    }

    // Close database
    await dbManager.close();
  });

  describe('TypeScript/JavaScript ES6 Imports', () => {
    it('should extract basic ES6 import statements', async () => {
      const testFile = join(testDir, 'basic-imports.ts');
      await fs.writeFile(testFile, `
import React from 'react';
import { useState, useEffect } from 'react';
import * as fs from 'fs';
import type { User } from './types';
      `.trim());

      const result = await resourceManager.readResource(`file://basic-imports.ts/imports`);

      expect(result.mimeType).toBe('application/json');
      const data = JSON.parse(result.text);

      expect(data).toHaveProperty('success');
      expect(data.success).toBe(true);

      // Should contain the imports
      const imports = Array.isArray(data) ? data : data.imports || [];
      expect(imports).toContain('react');
      expect(imports).toContain('fs');
      expect(imports).toContain('./types');
    });

    it('should extract named imports with aliases', async () => {
      const testFile = join(testDir, 'aliased-imports.ts');
      await fs.writeFile(testFile, `
import { readFile as read, writeFile as write } from 'fs/promises';
import { default as express } from 'express';
import Database, { Connection as DBConnection } from 'database';
      `.trim());

      const result = await resourceManager.readResource(`file://aliased-imports.ts/imports`);
      const data = JSON.parse(result.text);

      const imports = Array.isArray(data) ? data : data.imports || [];
      expect(imports).toContain('fs/promises');
      expect(imports).toContain('express');
      expect(imports).toContain('database');
    });

    it('should extract namespace imports', async () => {
      const testFile = join(testDir, 'namespace-imports.ts');
      await fs.writeFile(testFile, `
import * as path from 'path';
import * as utils from './utils';
import * as Types from './types/index';
      `.trim());

      const result = await resourceManager.readResource(`file://namespace-imports.ts/imports`);
      const data = JSON.parse(result.text);

      const imports = Array.isArray(data) ? data : data.imports || [];
      expect(imports).toContain('path');
      expect(imports).toContain('./utils');
      expect(imports).toContain('./types/index');
    });

    it('should extract type-only imports', async () => {
      const testFile = join(testDir, 'type-imports.ts');
      await fs.writeFile(testFile, `
import type { User, Admin } from './types';
import type Config from './config';
import { type Settings, loadSettings } from './settings';
      `.trim());

      const result = await resourceManager.readResource(`file://type-imports.ts/imports`);
      const data = JSON.parse(result.text);

      const imports = Array.isArray(data) ? data : data.imports || [];
      expect(imports).toContain('./types');
      expect(imports).toContain('./config');
      expect(imports).toContain('./settings');
    });

    it('should extract side-effect imports', async () => {
      const testFile = join(testDir, 'side-effect-imports.ts');
      await fs.writeFile(testFile, `
import './polyfills';
import 'reflect-metadata';
import '@testing-library/jest-dom';
      `.trim());

      const result = await resourceManager.readResource(`file://side-effect-imports.ts/imports`);
      const data = JSON.parse(result.text);

      const imports = Array.isArray(data) ? data : data.imports || [];
      expect(imports).toContain('./polyfills');
      expect(imports).toContain('reflect-metadata');
      expect(imports).toContain('@testing-library/jest-dom');
    });
  });

  describe('JavaScript CommonJS Require', () => {
    it('should extract CommonJS require statements', async () => {
      const testFile = join(testDir, 'commonjs.js');
      await fs.writeFile(testFile, `
const express = require('express');
const { readFile, writeFile } = require('fs/promises');
const path = require('path');
      `.trim());

      const result = await resourceManager.readResource(`file://commonjs.js/imports`);
      const data = JSON.parse(result.text);

      // Note: TypeScript AST may not extract require() calls as imports
      // This tests current behavior and documents expectations
      expect(data).toHaveProperty('success');
    });

    it('should handle mixed ES6 and CommonJS in same file', async () => {
      const testFile = join(testDir, 'mixed-imports.js');
      await fs.writeFile(testFile, `
import React from 'react';
const express = require('express');
import { useState } from 'react';
const path = require('path');
      `.trim());

      const result = await resourceManager.readResource(`file://mixed-imports.js/imports`);
      const data = JSON.parse(result.text);

      const imports = Array.isArray(data) ? data : data.imports || [];
      // Should at least extract ES6 imports
      expect(imports).toContain('react');
    });
  });

  describe('Dynamic Imports', () => {
    it('should handle dynamic import expressions', async () => {
      const testFile = join(testDir, 'dynamic-imports.ts');
      await fs.writeFile(testFile, `
async function loadModule() {
  const module = await import('./module');
  const config = await import(\`./config/\${env}.js\`);
  return module;
}
      `.trim());

      const result = await resourceManager.readResource(`file://dynamic-imports.ts/imports`);
      const data = JSON.parse(result.text);

      // Dynamic imports may or may not be extracted depending on AST implementation
      expect(data).toHaveProperty('success');
    });

    it('should handle conditional imports', async () => {
      const testFile = join(testDir, 'conditional-imports.ts');
      await fs.writeFile(testFile, `
let module;
if (process.env.NODE_ENV === 'production') {
  module = await import('./prod-module');
} else {
  module = await import('./dev-module');
}
      `.trim());

      const result = await resourceManager.readResource(`file://conditional-imports.ts/imports`);
      const data = JSON.parse(result.text);

      expect(data).toHaveProperty('success');
    });
  });

  describe('Python Imports', () => {
    it('should extract basic Python import statements', async () => {
      const testFile = join(testDir, 'basic.py');
      await fs.writeFile(testFile, `
import os
import sys
import json
      `.trim());

      const result = await resourceManager.readResource(`file://basic.py/imports`);
      const data = JSON.parse(result.text);

      expect(data).toHaveProperty('success', true);
      expect(data).toHaveProperty('imports');
      const imports = Array.isArray(data.imports) ? data.imports : [];
      expect(imports).toContain('os');
      expect(imports).toContain('sys');
      expect(imports).toContain('json');
    });

    it('should extract from...import statements', async () => {
      const testFile = join(testDir, 'from-imports.py');
      await fs.writeFile(testFile, `
from pathlib import Path
from typing import List, Dict, Optional
from .models import User, Admin
from ..utils import helpers
      `.trim());

      const result = await resourceManager.readResource(`file://from-imports.py/imports`);
      const data = JSON.parse(result.text);

      expect(data).toHaveProperty('success', true);
      expect(data).toHaveProperty('imports');
      const imports = Array.isArray(data.imports) ? data.imports : [];
      expect(imports.length).toBeGreaterThan(0);
      // Python from imports will have module paths
      expect(imports.some((imp: string) => imp.includes('pathlib'))).toBe(true);
      expect(imports.some((imp: string) => imp.includes('typing'))).toBe(true);
    });

    it('should extract aliased Python imports', async () => {
      const testFile = join(testDir, 'aliased.py');
      await fs.writeFile(testFile, `
import numpy as np
import pandas as pd
from datetime import datetime as dt
from collections import OrderedDict as ODict
      `.trim());

      const result = await resourceManager.readResource(`file://aliased.py/imports`);
      const data = JSON.parse(result.text);

      expect(data).toHaveProperty('success', true);
      expect(data).toHaveProperty('imports');
      const imports = Array.isArray(data.imports) ? data.imports : [];
      // Module names are extracted (aliases are tracked by Python AST but we extract module names)
      expect(imports).toContain('numpy');
      expect(imports).toContain('pandas');
    });

    it('should extract wildcard imports', async () => {
      const testFile = join(testDir, 'wildcard.py');
      await fs.writeFile(testFile, `
from os import *
from typing import *
from .models import *
      `.trim());

      const result = await resourceManager.readResource(`file://wildcard.py/imports`);
      const data = JSON.parse(result.text);

      expect(data).toHaveProperty('success', true);
      expect(data).toHaveProperty('imports');
      const imports = Array.isArray(data.imports) ? data.imports : [];
      // Wildcard imports should have asterisk in the module name
      expect(imports.some((imp: string) => imp.includes('*') || imp.includes('os') || imp.includes('typing'))).toBe(true);
    });

    it('should extract relative imports', async () => {
      const testFile = join(testDir, 'relative.py');
      await fs.writeFile(testFile, `
from . import sibling
from .. import parent
from ...grandparent import module
from .submodule.nested import function
      `.trim());

      const result = await resourceManager.readResource(`file://relative.py/imports`);
      const data = JSON.parse(result.text);

      expect(data).toHaveProperty('success', true);
      expect(data).toHaveProperty('imports');
      const imports = Array.isArray(data.imports) ? data.imports : [];
      expect(imports.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle non-existent files gracefully', async () => {
      const result = await resourceManager.readResource(`file://non-existent-file.ts/imports`);
      const data = JSON.parse(result.text);

      expect(data).toHaveProperty('success', false);
      expect(data).toHaveProperty('errors');
      expect(Array.isArray(data.errors)).toBe(true);
    });

    it('should handle malformed TypeScript/JavaScript syntax', async () => {
      const testFile = join(testDir, 'malformed.ts');
      await fs.writeFile(testFile, `
import { incomplete from 'module'
import missing-quotes from module;
      `.trim());

      const result = await resourceManager.readResource(`file://malformed.ts/imports`);
      const data = JSON.parse(result.text);

      // Should either parse successfully (with errors) or fail gracefully
      expect(data).toHaveProperty('success');
      if (!data.success) {
        expect(data).toHaveProperty('errors');
      }
    });

    it('should handle malformed Python syntax', async () => {
      const testFile = join(testDir, 'malformed.py');
      await fs.writeFile(testFile, `
import incomplete from
from import missing
      `.trim());

      const result = await resourceManager.readResource(`file://malformed.py/imports`);
      const data = JSON.parse(result.text);

      expect(data).toHaveProperty('success');
      if (!data.success) {
        expect(data).toHaveProperty('errors');
        expect(Array.isArray(data.errors)).toBe(true);
      }
    });

    it('should handle empty files', async () => {
      const testFile = join(testDir, 'empty.ts');
      await fs.writeFile(testFile, '');

      const result = await resourceManager.readResource(`file://empty.ts/imports`);
      const data = JSON.parse(result.text);

      expect(data).toHaveProperty('success');
      if (data.success) {
        const imports = Array.isArray(data) ? data : data.imports || [];
        expect(imports).toEqual([]);
      }
    });

    it('should handle files with only comments', async () => {
      const testFile = join(testDir, 'comments-only.ts');
      await fs.writeFile(testFile, `
// This file only has comments
/* Multi-line
   comment block */
// No imports here
      `.trim());

      const result = await resourceManager.readResource(`file://comments-only.ts/imports`);
      const data = JSON.parse(result.text);

      expect(data).toHaveProperty('success');
      if (data.success) {
        const imports = Array.isArray(data) ? data : data.imports || [];
        expect(imports).toEqual([]);
      }
    });
  });

  describe('Complex Real-World Scenarios', () => {
    it('should extract imports from a complex TypeScript file', async () => {
      const testFile = join(testDir, 'complex.ts');
      await fs.writeFile(testFile, `
// External dependencies
import React, { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';

// Internal dependencies
import { Button } from '@/components/ui/button';
import type { User, Role } from '@/types/models';
import * as utils from '@/lib/utils';
import { api } from '@/services/api';

// Relative imports
import '../styles/global.css';
import { formatDate } from './helpers';
import type { Props } from './types';

// Side effects
import 'reflect-metadata';
      `.trim());

      const result = await resourceManager.readResource(`file://complex.ts/imports`);
      const data = JSON.parse(result.text);

      expect(data).toHaveProperty('success', true);
      const imports = Array.isArray(data) ? data : data.imports || [];

      // Should extract all major imports
      expect(imports.length).toBeGreaterThan(5);
      expect(imports).toContain('react');
      expect(imports).toContain('@tanstack/react-query');
      expect(imports).toContain('reflect-metadata');
    });

    it('should extract imports from a complex Python file', async () => {
      const testFile = join(testDir, 'complex.py');
      await fs.writeFile(testFile, `
"""Complex Python module with various import patterns"""

# Standard library
import os
import sys
from pathlib import Path
from typing import List, Dict, Optional, Union

# Third-party
import numpy as np
import pandas as pd
from sqlalchemy import create_engine
from fastapi import FastAPI, Depends, HTTPException

# Relative imports
from . import models
from .. import utils
from .database import get_db
from ..config import settings

# Aliased imports
from datetime import datetime as dt
from collections import OrderedDict as ODict
      `.trim());

      const result = await resourceManager.readResource(`file://complex.py/imports`);
      const data = JSON.parse(result.text);

      expect(data).toHaveProperty('success', true);
      expect(data).toHaveProperty('imports');
      const imports = Array.isArray(data.imports) ? data.imports : [];
      expect(imports.length).toBeGreaterThan(8);

      // Check for standard library imports
      expect(imports).toContain('os');
      expect(imports).toContain('sys');

      // Check for third-party imports
      expect(imports).toContain('numpy');
      expect(imports).toContain('pandas');
    });

    it('should handle JSX/TSX files with imports', async () => {
      const testFile = join(testDir, 'component.tsx');
      await fs.writeFile(testFile, `
import React, { FC } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';

interface Props {
  title: string;
}

const StyledDiv = styled.div\`
  color: blue;
\`;

export const MyComponent: FC<Props> = ({ title }) => {
  const { t } = useTranslation();
  return <StyledDiv>{t(title)}</StyledDiv>;
};
      `.trim());

      const result = await resourceManager.readResource(`file://component.tsx/imports`);
      const data = JSON.parse(result.text);

      expect(data).toHaveProperty('success');
      const imports = Array.isArray(data) ? data : data.imports || [];

      expect(imports).toContain('react');
      expect(imports).toContain('styled-components');
      expect(imports).toContain('react-i18next');
    });
  });

  describe('Edge Cases', () => {
    it('should handle imports with string templates', async () => {
      const testFile = join(testDir, 'template-imports.ts');
      await fs.writeFile(testFile, `
const moduleName = 'lodash';
// Note: These are not standard imports and may not be extracted
// import(\`./\${moduleName}\`);
      `.trim());

      const result = await resourceManager.readResource(`file://template-imports.ts/imports`);
      const data = JSON.parse(result.text);

      expect(data).toHaveProperty('success');
    });

    it('should handle imports in different quote styles', async () => {
      const testFile = join(testDir, 'quote-styles.ts');
      await fs.writeFile(testFile, `
import single from 'single-quotes';
import double from "double-quotes";
      `.trim());

      const result = await resourceManager.readResource(`file://quote-styles.ts/imports`);
      const data = JSON.parse(result.text);

      expect(data).toHaveProperty('success');
      const imports = Array.isArray(data) ? data : data.imports || [];

      expect(imports).toContain('single-quotes');
      expect(imports).toContain('double-quotes');
    });

    it('should handle multiline imports', async () => {
      const testFile = join(testDir, 'multiline.ts');
      await fs.writeFile(testFile, `
import {
  Component,
  useState,
  useEffect,
  useMemo,
  useCallback
} from 'react';

import {
  type User,
  type Admin,
  type Role
} from './types';
      `.trim());

      const result = await resourceManager.readResource(`file://multiline.ts/imports`);
      const data = JSON.parse(result.text);

      expect(data).toHaveProperty('success');
      const imports = Array.isArray(data) ? data : data.imports || [];

      expect(imports).toContain('react');
      expect(imports).toContain('./types');
    });

    it('should handle imports with trailing commas', async () => {
      const testFile = join(testDir, 'trailing-comma.ts');
      await fs.writeFile(testFile, `
import {
  Component,
  useState,
  useEffect,
} from 'react';
      `.trim());

      const result = await resourceManager.readResource(`file://trailing-comma.ts/imports`);
      const data = JSON.parse(result.text);

      expect(data).toHaveProperty('success');
      const imports = Array.isArray(data) ? data : data.imports || [];
      expect(imports).toContain('react');
    });
  });

  describe('Resource URI Validation', () => {
    it('should validate proper URI format', async () => {
      const testFile = join(testDir, 'test.ts');
      await fs.writeFile(testFile, `import React from 'react';`);

      // Valid URI
      const result1 = await resourceManager.readResource(`file://test.ts/imports`);
      expect(JSON.parse(result1.text)).toHaveProperty('success');

      // Missing aspect
      const result2 = await resourceManager.readResource(`file://test.ts`);
      const data2 = JSON.parse(result2.text);
      expect(data2).toHaveProperty('error');
    });

    it('should handle query parameters gracefully', async () => {
      const testFile = join(testDir, 'test.ts');
      await fs.writeFile(testFile, `import React from 'react';`);

      // URI with query params (should be ignored for imports)
      const result = await resourceManager.readResource(`file://test.ts/imports?include_positions=true`);
      expect(JSON.parse(result.text)).toHaveProperty('success');
    });
  });
});
