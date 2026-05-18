const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const companiesDir = path.join(__dirname, 'public', 'data', 'companies');
const registryFile = path.join(companiesDir, 'registry.json');

// Premium baseline metadata for the 13 preloaded companies
const BASELINE_METADATA = {
  "ITC": {
    name: "ITC Ltd",
    ticker: "ITC",
    sector: "FMCG / Cigarettes",
    type: "conglomerate",
    description: "Diversified conglomerate — cigarettes, FMCG, hotels, paper, agri",
    emoji: "🚬",
    showcaseFor: "SOTP valuation across multiple segments",
  },
  "HDFC bank": {
    name: "HDFC Bank",
    ticker: "HDFCBANK",
    sector: "Banking",
    type: "bank",
    description: "Largest private-sector bank by assets",
    emoji: "🏦",
    showcaseFor: "Bank-specific quality_indicators pipeline",
  },
  "ICICI bank": {
    name: "ICICI Bank",
    ticker: "ICICIBANK",
    sector: "Banking",
    type: "bank",
    description: "Universal bank with strong digital franchise",
    emoji: "🏦",
  },
  "KOTAKBANK": {
    name: "Kotak Mahindra Bank",
    ticker: "KOTAKBANK",
    sector: "Banking",
    type: "bank",
    description: "Premium private bank with conservative loan book",
    emoji: "🏦",
  },
  "SBIN": {
    name: "State Bank of India",
    ticker: "SBIN",
    sector: "Banking (PSU)",
    type: "bank",
    description: "Largest public-sector bank",
    emoji: "🏛️",
  },
  "bajaj finance": {
    name: "Bajaj Finance",
    ticker: "BAJFINANCE",
    sector: "NBFC",
    type: "nbfc",
    description: "Consumer finance NBFC with retail loan focus",
    emoji: "💳",
    showcaseFor: "NBFC routing — borrowings/equity leverage frame",
  },
  "Life Insurance Corporation of India": {
    name: "LIC",
    ticker: "LIFI",
    sector: "Insurance (Life)",
    type: "insurance",
    description: "State-owned life insurer, dominant market share",
    emoji: "🛡️",
    showcaseFor: "Insurance fail-closed (no equity-side valuation)",
  },
  "Power Grid Corporation of India Ltd": {
    name: "Power Grid",
    ticker: "POWERGRID",
    sector: "Utility (PSU)",
    type: "utility",
    description: "Inter-state electricity transmission monopoly",
    emoji: "⚡",
    showcaseFor: "Regulated utility with stable returns",
  },
  "Tata Consultancy Services Ltd": {
    name: "TCS",
    ticker: "TCS",
    sector: "IT Services",
    type: "it-services",
    description: "Global IT services leader, capital-light",
    emoji: "💻",
    showcaseFor: "IT-services detector + moat scorer awareness",
  },
  "Tata steel": {
    name: "Tata Steel",
    ticker: "TATASTEEL",
    sector: "Metals (Cyclical)",
    type: "cyclical",
    description: "Integrated steel producer, India + Europe",
    emoji: "🏗️",
    showcaseFor: "Cyclical normalization + cycle-aware terminal RE",
  },
  "paytm": {
    name: "Paytm (One97)",
    ticker: "PAYTM",
    sector: "Fintech",
    type: "loss-maker",
    description: "Digital payments + financial services platform",
    emoji: "📱",
    showcaseFor: "Loss-maker valuation pipeline (no positive earnings)",
  },
  "reliance Industries": {
    name: "Reliance Industries",
    ticker: "RELIANCE",
    sector: "Conglomerate",
    type: "conglomerate",
    description: "O2C + telecom (Jio) + retail + new energy",
    emoji: "🛢️",
    showcaseFor: "Mixed conglomerate routing + segment-aware SOTP",
  },
  "Vodafone Idea Ltd": {
    name: "Vodafone Idea",
    ticker: "IDEA",
    sector: "Telecom",
    type: "telecom",
    description: "3rd-largest telco — chronic losses, negative net worth",
    emoji: "📡",
    showcaseFor: "Negative-equity stress test (distress detector)",
  }
};

// Title-case helper
function toTitleCase(str) {
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

async function syncAndPackCompany(folderName) {
  const companyPath = path.join(companiesDir, folderName);
  const standalonePath = path.join(companyPath, 'standalone');
  let hasStandalone = false;

  // 1a. Automatically build/check consolidated zip
  const consolidatedZipPath = path.join(companyPath, `${folderName}.zip`);
  const rootDirFiles = fs.readdirSync(companyPath);
  const xlsFiles = rootDirFiles.filter(f => f.endsWith('.xls') || f.endsWith('.xlsx'));
  
  if (xlsFiles.length > 0) {
    try {
      const zip = new JSZip();
      
      // Add root xls files
      for (const file of xlsFiles) {
        zip.file(file, fs.readFileSync(path.join(companyPath, file)));
      }
      
      // Add revised consolidated files
      const revisedPath = path.join(companyPath, 'revised schd');
      if (fs.existsSync(revisedPath) && fs.statSync(revisedPath).isDirectory()) {
        const revFiles = fs.readdirSync(revisedPath);
        for (const file of revFiles) {
          const filePath = path.join(revisedPath, file);
          if (fs.statSync(filePath).isFile()) {
            zip.file(`revised schd/${file}`, fs.readFileSync(filePath));
          }
        }
      }
      
      // Add standard consolidated files
      const stdPath = path.join(companyPath, 'standard');
      if (fs.existsSync(stdPath) && fs.statSync(stdPath).isDirectory()) {
        const stdFiles = fs.readdirSync(stdPath);
        for (const file of stdFiles) {
          const filePath = path.join(stdPath, file);
          if (fs.statSync(filePath).isFile()) {
            zip.file(`standard/${file}`, fs.readFileSync(filePath));
          }
        }
      }
      
      const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
      fs.writeFileSync(consolidatedZipPath, buffer);
      console.log(`✓ Synchronized consolidated ZIP for ${folderName}`);
    } catch (zipErr) {
      console.error(`Warning: Failed to package consolidated files for ${folderName}:`, zipErr);
    }
  }

  // 1. Automatically build/check standalone zip
  if (fs.existsSync(standalonePath) && fs.statSync(standalonePath).isDirectory()) {
    hasStandalone = true;
    
    // Check if zip already exists or if we should write it
    const standaloneZipPath = path.join(companyPath, 'standalone.zip');
    
    try {
      const zip = new JSZip();
      
      // Add root standalone files
      const rootFiles = fs.readdirSync(standalonePath);
      for (const file of rootFiles) {
        const filePath = path.join(standalonePath, file);
        if (fs.statSync(filePath).isFile()) {
          zip.file(file, fs.readFileSync(filePath));
        }
      }

      // Add revised standalone files
      const revisedPath = path.join(companyPath, 'revised schd', 'standalone');
      if (fs.existsSync(revisedPath)) {
        const revFiles = fs.readdirSync(revisedPath);
        for (const file of revFiles) {
          const filePath = path.join(revisedPath, file);
          if (fs.statSync(filePath).isFile()) {
            zip.file(`revised schd/${file}`, fs.readFileSync(filePath));
          }
        }
      }

      // Add standard standalone files
      const stdPath = path.join(companyPath, 'standard', 'standalone');
      if (fs.existsSync(stdPath)) {
        const stdFiles = fs.readdirSync(stdPath);
        for (const file of stdFiles) {
          const filePath = path.join(stdPath, file);
          if (fs.statSync(filePath).isFile()) {
            zip.file(`standard/${file}`, fs.readFileSync(filePath));
          }
        }
      }

      const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
      fs.writeFileSync(standaloneZipPath, buffer);
      console.log(`✓ Synchronized standalone.zip for ${folderName}`);
    } catch (zipErr) {
      console.error(`Warning: Failed to package standalone files for ${folderName}:`, zipErr);
    }
  } else if (fs.existsSync(path.join(companyPath, 'standalone.zip'))) {
    hasStandalone = true;
  }

  // 2. Fetch or generate metadata
  let metadata = BASELINE_METADATA[folderName];
  
  if (!metadata) {
    // Attempt to load metadata.json if developer provided one inside the folder
    const metadataPath = path.join(companyPath, 'metadata.json');
    if (fs.existsSync(metadataPath)) {
      try {
        metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        console.log(`✓ Loaded custom metadata.json for ${folderName}`);
      } catch (err) {
        console.error(`Warning: Invalid metadata.json in ${folderName}, applying fallbacks.`, err);
      }
    }
  }

  if (!metadata) {
    // Smart fallbacks for newly added folders
    const name = toTitleCase(folderName);
    const ticker = folderName.replace(/\s+/g, '').toUpperCase().slice(0, 12);
    
    // Type detection based on keywords
    let type = "industrial";
    const lowerFolder = folderName.toLowerCase();
    if (lowerFolder.includes("bank")) {
      type = "bank";
    } else if (lowerFolder.includes("nbfc") || lowerFolder.includes("finance") || lowerFolder.includes("capital")) {
      type = "nbfc";
    } else if (lowerFolder.includes("insurance") || lowerFolder.includes("lic")) {
      type = "insurance";
    } else if (lowerFolder.includes("utility") || lowerFolder.includes("power") || lowerFolder.includes("grid") || lowerFolder.includes("energy")) {
      type = "utility";
    } else if (lowerFolder.includes("telecom") || lowerFolder.includes("communication")) {
      type = "telecom";
    } else if (lowerFolder.includes("tcs") || lowerFolder.includes("consultancy") || lowerFolder.includes("software") || lowerFolder.includes("tech")) {
      type = "it-services";
    }

    // Emoji assignment based on type
    let emoji = "🏢";
    if (type === "bank") emoji = "🏦";
    else if (type === "nbfc") emoji = "💳";
    else if (type === "insurance") emoji = "🛡️";
    else if (type === "utility") emoji = "⚡";
    else if (type === "telecom") emoji = "📡";
    else if (type === "it-services") emoji = "💻";

    const sector = toTitleCase(type.replace("-", " "));
    const description = `Pre-loaded Capitaline financial dataset for ${name}.`;

    metadata = {
      name,
      ticker,
      sector,
      type,
      description,
      emoji
    };
    console.log(`✓ Discovered new company "${name}" with inferred type: ${type}`);
  }

  return {
    folder: folderName,
    ...metadata,
    hasStandalone
  };
}

async function run() {
  if (!fs.existsSync(companiesDir)) {
    console.error('Error: Companies directory does not exist!');
    process.exit(1);
  }

  const items = fs.readdirSync(companiesDir);
  const companyList = [];

  for (const item of items) {
    const itemPath = path.join(companiesDir, item);
    if (fs.statSync(itemPath).isDirectory()) {
      const company = await syncAndPackCompany(item);
      companyList.push(company);
    }
  }

  // Sort companies alphabetically by name
  companyList.sort((a, b) => a.name.localeCompare(b.name));

  fs.writeFileSync(registryFile, JSON.stringify(companyList, null, 2));
  console.log(`\nRegistry compiled successfully! Wrote ${companyList.length} companies to ${registryFile}\n`);
}

run().catch(err => {
  console.error('Registry sync failed:', err);
  process.exit(1);
});
