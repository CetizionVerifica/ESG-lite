// PACT Technical Specifications v3.0.3 ProductFootprint, generated from https://raw.githubusercontent.com/wbcsd/data-exchange-protocol/main/spec/v3/openapi.yaml (components.schemas, reachable from ProductFootprint; descriptions and examples dropped). Regenerate rather than edit.
// Generated file: regenerate from the PACT OpenAPI file rather than editing by hand.
/* eslint-disable */
export const PACT_SPEC_VERSION = "3.0.3";

export const productFootprintSchema = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": [
    "id",
    "specVersion",
    "created",
    "status",
    "companyName",
    "companyIds",
    "productDescription",
    "productIds",
    "productNameCompany",
    "pcf"
  ],
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "specVersion": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+\\.\\d+(-\\d{8})?$"
    },
    "precedingPfIds": {
      "x-rule": "SHOULD",
      "type": "array",
      "items": {
        "type": "string",
        "format": "uuid"
      },
      "minItems": 1,
      "uniqueItems": true
    },
    "created": {
      "type": "string",
      "format": "date-time"
    },
    "status": {
      "type": "string",
      "enum": [
        "Active",
        "Deprecated"
      ]
    },
    "validityPeriodStart": {
      "type": "string",
      "format": "date-time",
      "x-term": "Validity Period",
      "x-methodology": "3.2.3"
    },
    "validityPeriodEnd": {
      "type": "string",
      "format": "date-time",
      "x-term": "Validity Period",
      "x-methodology": "3.2.3"
    },
    "companyName": {
      "$ref": "#/$defs/NonEmptyString"
    },
    "companyIds": {
      "type": "array",
      "minItems": 1,
      "uniqueItems": true,
      "items": {
        "$ref": "#/$defs/Urn"
      }
    },
    "productDescription": {
      "type": "string"
    },
    "productIds": {
      "type": "array",
      "minItems": 1,
      "uniqueItems": true,
      "items": {
        "$ref": "#/$defs/Urn"
      }
    },
    "productClassifications": {
      "note": "Replaces productCategoryCpc deprecated in 2.3",
      "type": "array",
      "minItems": 1,
      "uniqueItems": true,
      "items": {
        "$ref": "#/$defs/Urn"
      }
    },
    "productNameCompany": {
      "$ref": "#/$defs/NonEmptyString"
    },
    "comment": {
      "type": "string",
      "x-rule": "SHOULD"
    },
    "pcf": {
      "$ref": "#/$defs/CarbonFootprint"
    },
    "extensions": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/DataModelExtension"
      }
    }
  },
  "$defs": {
    "CarbonFootprint": {
      "type": "object",
      "required": [
        "declaredUnitOfMeasurement",
        "declaredUnitAmount",
        "productMassPerDeclaredUnit",
        "referencePeriodStart",
        "referencePeriodEnd",
        "pcfExcludingBiogenicUptake",
        "pcfIncludingBiogenicUptake",
        "fossilGhgEmissions",
        "fossilCarbonContent",
        "ipccCharacterizationFactors",
        "crossSectoralStandards",
        "exemptedEmissionsPercent"
      ],
      "oneOf": [
        {
          "oneOf": [
            {
              "required": [
                "geographyRegionOrSubregion"
              ]
            },
            {
              "required": [
                "geographyCountry"
              ]
            },
            {
              "required": [
                "geographyCountrySubdivision"
              ]
            }
          ]
        },
        {
          "not": {
            "anyOf": [
              {
                "required": [
                  "geographyRegionOrSubregion"
                ]
              },
              {
                "required": [
                  "geographyCountry"
                ]
              },
              {
                "required": [
                  "geographyCountrySubdivision"
                ]
              }
            ]
          }
        }
      ],
      "properties": {
        "declaredUnitOfMeasurement": {
          "type": "string",
          "enum": [
            "liter",
            "kilogram",
            "cubic meter",
            "kilowatt hour",
            "megajoule",
            "ton kilometer",
            "square meter",
            "piece",
            "hour",
            "megabit second"
          ],
          "x-term": "Declared Unit",
          "x-methodology": "3.2.4"
        },
        "declaredUnitAmount": {
          "$ref": "#/$defs/PositiveNonZeroDecimal",
          "x-unit": "declared unit",
          "x-term": "Declared Unit",
          "x-methodology": "3.2.4"
        },
        "productMassPerDeclaredUnit": {
          "note": "mandatory in 3.0, optional in v2.x",
          "$ref": "#/$defs/Decimal",
          "x-term": "Declared Unit",
          "x-methodology": "3.2.4"
        },
        "referencePeriodStart": {
          "type": "string",
          "format": "date-time",
          "x-term": "Reference period",
          "x-methodology": "3.2.3"
        },
        "referencePeriodEnd": {
          "type": "string",
          "format": "date-time",
          "x-term": "Reference period",
          "x-methodology": "3.2.3"
        },
        "geographyRegionOrSubregion": {
          "type": "string",
          "x-rule": "SHOULD",
          "x-term": "Region or Sub-Region",
          "x-methodology": "3.2.3",
          "enum": [
            "Africa",
            "Americas",
            "Asia",
            "Europe",
            "Oceania",
            "Australia and New Zealand",
            "Central Asia",
            "Eastern Asia",
            "Eastern Europe",
            "Latin America and the Caribbean",
            "Melanesia",
            "Micronesia",
            "Northern Africa",
            "Northern America",
            "Northern Europe",
            "Polynesia",
            "South-eastern Asia",
            "Southern Asia",
            "Southern Europe",
            "Sub-Saharan Africa",
            "Western Asia",
            "Western Europe"
          ]
        },
        "geographyCountry": {
          "type": "string",
          "pattern": "^[A-Z]{2}$",
          "x-rule": "SHOULD",
          "x-term": "Country",
          "x-methodology": "3.2.3"
        },
        "geographyCountrySubdivision": {
          "type": "string",
          "pattern": "^[A-Z]{2}-[A-Z0-9]{1,3}$",
          "x-rule": "SHOULD",
          "x-term": "Country subdivision",
          "x-methodology": "3.2.3"
        },
        "boundaryProcessesDescription": {
          "note": "optional in 3.0, was mandatory in 2.x",
          "type": "string",
          "x-rule": "SHOULD",
          "x-methodology": 3.2
        },
        "pcfExcludingBiogenicUptake": {
          "x-unit": "kgCO2e/declared unit",
          "x-comment": "PCF (Excl. biogenic CO2 uptake) = \n  fossilGhgEmissions + \n  landUseChangeGhgEmissions + \n  landManagementBiogenicCO2Emissions + \n  landManagementBiogenicCO2Removals + \n  technologicalCO2Removals + \n  ccsTechnologicalCO2Capture\n  biogenicNonCO2Emissions\n",
          "x-rule": "SHALL",
          "x-term": "PCF Excluding biogenic CO2 uptake",
          "x-methodology": "3.3.1",
          "$ref": "#/$defs/Decimal"
        },
        "pcfIncludingBiogenicUptake": {
          "x-unit": "kgCO2e/declared unit",
          "x-comment": "PCF (Incl. biogenic CO2 uptake) = \n  fossilGhgEmissions + \n  landUseChangeGhgEmissions + \n  landManagementBiogenicCO2Emissions + \n  landManagementBiogenicCO2Removals + \n  technologicalCO2Removals + \n  ccsTechnologicalCO2Capture\n  biogenicNonCO2Emissions + \n  biogenicCO2Uptake\n",
          "x-rule": "SHALL",
          "x-term": "PCF Including biogenic CO2 uptake",
          "x-methodology": "3.3.1",
          "$ref": "#/$defs/Decimal"
        },
        "fossilCarbonContent": {
          "x-unit": "kgC/declared unit",
          "x-rule": "SHALL",
          "x-term": "Fossil carbon content",
          "x-methodology": "3.3.2.4",
          "$ref": "#/$defs/PositiveOrZeroDecimal"
        },
        "biogenicCarbonContent": {
          "x-unit": "kgC/declared unit",
          "x-rule": "BIO",
          "x-term": "Biogenic carbon content",
          "x-methodology": "3.3.2.4",
          "$ref": "#/$defs/PositiveOrZeroDecimal"
        },
        "recycledCarbonContent": {
          "$ref": "#/$defs/PositiveOrZeroDecimal",
          "x-unit": "kgC/declared unit",
          "x-rule": "SHOULD",
          "x-term": "Recycled carbon content",
          "x-methodology": "3.3.2.2"
        },
        "fossilGhgEmissions": {
          "x-unit": "kgCO2e/declared unit",
          "x-rule": "SHALL",
          "x-term": "Fossil emissions",
          "x-methodology": "3.3.2.4",
          "$ref": "#/$defs/PositiveOrZeroDecimal"
        },
        "landUseChangeGhgEmissions": {
          "x-unit": "kgCO2e/declared unit",
          "x-rule": "BIO",
          "x-term": "Land use and land use change emissions or LUC emissions",
          "x-comment": "Replaces dLucGhgEmissions",
          "x-methodology": "3.3.2.4",
          "$ref": "#/$defs/PositiveOrZeroDecimal"
        },
        "landCarbonLeakage": {
          "x-unit": "kgCO2e/declared unit",
          "x-comment": "Placeholder.",
          "$ref": "#/$defs/PositiveOrZeroDecimal"
        },
        "landManagementFossilGhgEmissions": {
          "x-unit": "kgCO2e/declared unit",
          "x-rule": "BIO-2027",
          "x-term": "Fossil emissions - land management",
          "x-methodology": "3.3.2.4",
          "$ref": "#/$defs/PositiveOrZeroDecimal"
        },
        "landManagementBiogenicCO2Emissions": {
          "x-unit": "kgCO2e/declared unit",
          "x-rule": "BIO-2027",
          "x-term": "Land management CO2 emissions",
          "x-methodology": "3.3.2.4",
          "$ref": "#/$defs/PositiveOrZeroDecimal"
        },
        "landManagementBiogenicCO2Removals": {
          "x-unit": "kgCO2e/declared unit",
          "x-term": "Land management CO2 removals",
          "x-methodology": "3.3.2.4",
          "$ref": "#/$defs/NegativeOrZeroDecimal"
        },
        "biogenicCO2Uptake": {
          "x-unit": "kgCO2e/declared unit",
          "x-rule": "BIO",
          "x-term": "Biogenic CO2 uptake",
          "x-methodology": "3.3.2.4",
          "$ref": "#/$defs/NegativeOrZeroDecimal",
          "x-comment": "Replaces biogenicCarbonWithdrawal"
        },
        "biogenicNonCO2Emissions": {
          "x-unit": "kgCO2e/declared unit",
          "x-rule": "BIO",
          "x-term": "Biogenic non-CO2 emissions",
          "x-methodology": "3.3.2.4",
          "$ref": "#/$defs/PositiveOrZeroDecimal"
        },
        "landAreaOccupation": {
          "x-unit": "(m2/year) / declared unit",
          "$ref": "#/$defs/PositiveOrZeroDecimal",
          "x-term": "Land occupation",
          "x-methodology": "3.3.2.4"
        },
        "aircraftGhgEmissions": {
          "x-unit": "kgCO2e/declared unit",
          "x-term": "Aircraft emissions",
          "x-methodology": "3.3.2.1",
          "$ref": "#/$defs/PositiveOrZeroDecimal"
        },
        "packagingEmissionsIncluded": {
          "type": "boolean",
          "x-rule": "SHALL",
          "x-term": "Packaging emissions",
          "x-methodology": "3.3.1.1"
        },
        "packagingGhgEmissions": {
          "$ref": "#/$defs/PositiveOrZeroDecimal",
          "x-rule": "SHOULD",
          "x-unit": "kgCO2e/declared unit",
          "x-term": "Packaging emissions",
          "x-methodology": "3.3.1.1"
        },
        "packagingBiogenicCarbonContent": {
          "$ref": "#/$defs/PositiveOrZeroDecimal",
          "x-unit": "kgC/declared unit",
          "x-term": "Packaging biogenic carbon content",
          "x-methodology": "3.3.1.1"
        },
        "outboundLogisticsGhgEmissions": {
          "$ref": "#/$defs/PositiveOrZeroDecimal",
          "x-rule": "SHOULD",
          "x-unit": "kgCO2e/declared unit",
          "x-term": "Outbound logistics emissions",
          "x-methodology": "3.3.2.1"
        },
        "ccsTechnologicalCO2CaptureIncluded": {
          "type": "boolean",
          "x-term": "Technological CO2 capture with geological storage",
          "x-rule": "SHALL",
          "x-methodology": "3.3.2.5"
        },
        "ccsTechnologicalCO2Capture": {
          "$ref": "#/$defs/NegativeOrZeroDecimal",
          "x-unit": "kgCO2e/declared unit",
          "x-term": "Technological CO2 capture with geological storage",
          "x-rule": "CCS",
          "x-methodology": "3.3.2.5"
        },
        "technologicalCO2CaptureOrigin": {
          "type": "string",
          "x-term": "Technological CO2 capture origin",
          "x-rule": "CCU,CCS",
          "x-methodology": "3.3.2.5"
        },
        "technologicalCO2Removals": {
          "x-unit": "kgCO2e/declared unit",
          "x-rule": "CCS",
          "x-term": "Technological CO2 removals",
          "x-methodology": "3.3.2.5",
          "$ref": "#/$defs/NegativeOrZeroDecimal"
        },
        "ccuCarbonContent": {
          "$ref": "#/$defs/PositiveOrZeroDecimal",
          "x-unit": "kgC/declared unit",
          "x-term": "CCU carbon content",
          "x-rule": "CCU",
          "x-methodology": "3.3.2.5"
        },
        "ccuCalculationApproach": {
          "type": "string",
          "enum": [
            "Cut-off",
            "Credit"
          ],
          "x-term": "CCU calculation approach",
          "x-methodology": "3.3.2.5",
          "x-rule": "CCU"
        },
        "ccuCreditCertification": {
          "$ref": "#/$defs/Uri",
          "x-term": "CCU credit certification",
          "x-methodology": "3.3.2.5",
          "x-rule": "CCU"
        },
        "ipccCharacterizationFactors": {
          "note": "supersedes `characterizationFactors` deprecated in 2.3.",
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^AR\\d+$"
          },
          "minItems": 1,
          "uniqueItems": true,
          "x-term": "Characterization factors",
          "x-methodology": "3.2.2"
        },
        "crossSectoralStandards": {
          "note": "Supersedes `crossSectoralStandardsUsed` deprecated in version 2.3.",
          "type": "array",
          "items": {
            "type": "string"
          },
          "minItems": 1,
          "uniqueItems": true,
          "x-term": "Cross-sectoral standards",
          "x-methodology": "3.1.2"
        },
        "productOrSectorSpecificRules": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/ProductOrSectorSpecificRule"
          },
          "minItems": 1,
          "uniqueItems": true,
          "x-term": "Product or sector specific rules",
          "x-methodology": "3.1.2",
          "note": "Multiple ProductOrSpecificRules can be specifed, each with its own operator and ruleNames."
        },
        "exemptedEmissionsPercent": {
          "note": "string<decimal> in 3.0, was Number in 2.x. Removed upper boundary of 5%.",
          "x-term": "Exemption rules",
          "x-methodology": "3.3.1.2",
          "$ref": "#/$defs/Decimal"
        },
        "exemptedEmissionsDescription": {
          "x-term": "Exemption rules",
          "x-methodology": "3.3.1.2",
          "note": "optional in 3.0, was mandatory in 2.x",
          "type": "string"
        },
        "allocationRulesDescription": {
          "type": "string",
          "x-rule": "SHOULD",
          "x-term": "Allocation rules",
          "x-methodology": "3.3.1.3"
        },
        "secondaryEmissionFactorSources": {
          "x-term": "Secondary emission factors sources",
          "x-methodology": "3.2.3",
          "x-rule": "SHOULD",
          "type": "array",
          "minItems": 1,
          "items": {
            "$ref": "#/$defs/EmissionFactorSource"
          }
        },
        "primaryDataShare": {
          "note": "string<decimal> in 3.0, was Number in 2.x",
          "x-rule": "SHALL",
          "x-term": "Primary Data Share",
          "x-methodology": "4.2.2",
          "$ref": "#/$defs/Decimal"
        },
        "dqi": {
          "x-rule": "SHALL-2027",
          "x-term": "Data Quality Indicators",
          "x-methodology": "4.2.3",
          "$ref": "#/$defs/DataQualityIndicators"
        },
        "verification": {
          "x-term": "Verification information",
          "x-rule": "MAY",
          "$ref": "#/$defs/Verification"
        }
      }
    },
    "DataModelExtension": {
      "type": "object",
      "required": [
        "specVersion",
        "dataSchema",
        "data"
      ],
      "properties": {
        "specVersion": {
          "type": "string"
        },
        "dataSchema": {
          "type": "string",
          "format": "uri"
        },
        "documentation": {
          "type": "string",
          "format": "uri"
        },
        "data": {
          "type": "object"
        }
      }
    },
    "DataQualityIndicators": {
      "type": "object",
      "x-methodology": "4.2.3",
      "required": [
        "technologicalDQR",
        "geographicalDQR",
        "temporalDQR"
      ],
      "properties": {
        "technologicalDQR": {
          "note": "string<decimal> in 3.0, was Number in 2.x",
          "x-term": "Technological representativeness",
          "x-rule": "SHALL",
          "$ref": "#/$defs/Decimal"
        },
        "geographicalDQR": {
          "note": "string<decimal> in 3.0, was Number in 2.x",
          "x-term": "Geographical representativenes",
          "x-rule": "SHALL",
          "$ref": "#/$defs/Decimal"
        },
        "temporalDQR": {
          "note": "string<decimal> in 3.0, was Number in 2.x",
          "x-term": "Temporal / Time representativenes",
          "x-rule": "SHALL",
          "$ref": "#/$defs/Decimal"
        }
      }
    },
    "Decimal": {
      "type": "string",
      "format": "decimal",
      "pattern": "^[+-]?\\d+(\\.\\d+)?$"
    },
    "EmissionFactorSource": {
      "type": "object",
      "required": [
        "name",
        "version"
      ],
      "properties": {
        "name": {
          "$ref": "#/$defs/NonEmptyString"
        },
        "version": {
          "$ref": "#/$defs/NonEmptyString"
        }
      }
    },
    "NegativeOrZeroDecimal": {
      "type": "string",
      "format": "decimal",
      "pattern": "^(-\\d+(\\.\\d+)?)|0+(\\.0+)?$"
    },
    "NonEmptyString": {
      "type": "string",
      "minLength": 1
    },
    "PositiveNonZeroDecimal": {
      "type": "string",
      "format": "decimal",
      "pattern": "^[+]?(\\d*[1-9]\\d*)(\\.\\d+)?|(0+\\.\\d*[1-9]\\d*)$"
    },
    "PositiveOrZeroDecimal": {
      "type": "string",
      "format": "decimal",
      "pattern": "^[+]?\\d+(\\.\\d+)?$"
    },
    "ProductOrSectorSpecificRule": {
      "type": "object",
      "required": [
        "operator",
        "ruleNames"
      ],
      "properties": {
        "operator": {
          "type": "string",
          "enum": [
            "PEF",
            "EPD International",
            "Other"
          ]
        },
        "ruleNames": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1
          },
          "minItems": 1,
          "uniqueItems": true
        },
        "otherOperatorName": {
          "type": "string",
          "minLength": 1
        }
      }
    },
    "Uri": {
      "type": "string",
      "format": "uri"
    },
    "Urn": {
      "type": "string",
      "format": "urn",
      "pattern": "^([uU][rR][nN]):"
    },
    "Verification": {
      "note": "Renamed from `Assurance` in 3.0",
      "type": "object",
      "properties": {
        "coverage": {
          "type": "string",
          "note": "values changed from v2.x",
          "enum": [
            "PCF calculation model",
            "PCF program",
            "product level"
          ],
          "x-term": "Coverage",
          "x-methodology": "5.3.3"
        },
        "providerName": {
          "note": "optional in version 3.0 was mandatory in 2.x",
          "type": "string",
          "x-term": "Verification provider",
          "x-methodology": "5.3.7"
        },
        "completedAt": {
          "type": "string",
          "format": "date-time"
        },
        "standardName": {
          "type": "string"
        },
        "comments": {
          "type": "string"
        }
      }
    }
  }
} as const;
