#!/usr/bin/env node

/**
 * Smart Content-Template Mapping Algorithm
 * 
 * Based on bbox positioning and visual proximity rather than hardcoded indices.
 * Implements the expert-recommended improvement over array index mapping.
 */

import fs from 'fs/promises';
import path from 'path';

class SmartMappingAlgorithm {
  constructor() {
    this.proximityThreshold = 150; // pixels
    this.yTolerance = 50; // pixels for "same row" detection
  }

  /**
   * Enhanced content-to-template mapping based on visual layout
   */
  mapContentToTemplate(contentBlocks, templateNodes) {
    const sortedContent = this.sortContentByVisualOrder(contentBlocks);
    const sortedTemplate = this.sortTemplateByVisualOrder(templateNodes);
    
    return {
      mappings: this.createOptimalMappings(sortedContent, sortedTemplate),
      strategy: 'bbox_visual_proximity',
      confidence: this.calculateMappingConfidence(sortedContent, sortedTemplate)
    };
  }

  sortContentByVisualOrder(contentBlocks) {
    return contentBlocks
      .filter(block => block.group_id && block.group_seq !== undefined)
      .sort((a, b) => {
        // Primary sort: group_id
        if (a.group_id !== b.group_id) {
          return a.group_id.localeCompare(b.group_id);
        }
        // Secondary sort: group_seq
        return (a.group_seq || 0) - (b.group_seq || 0);
      });
  }

  sortTemplateByVisualOrder(templateNodes) {
    const { images, title_groups, sources, paragraphs } = templateNodes;
    
    // Combine all template elements with their types
    const allElements = [
      ...images.map(node => ({ ...node, element_type: 'image' })),
      ...title_groups.map(node => ({ ...node, element_type: 'title' })),
      ...sources.map(node => ({ ...node, element_type: 'source' })),
      ...paragraphs.map(node => ({ ...node, element_type: 'paragraph' }))
    ];

    // Sort by Y position, then X position
    return allElements.sort((a, b) => {
      const yDiff = a.bbox.y - b.bbox.y;
      if (Math.abs(yDiff) > this.yTolerance) {
        return yDiff; // Different rows
      }
      return a.bbox.x - b.bbox.x; // Same row, sort by X
    });
  }

  createOptimalMappings(sortedContent, sortedTemplate) {
    const mappings = {
      figures: [],
      paragraphs: [],
      unmatched_content: [],
      unmatched_template: []
    };

    let templateIndex = 0;
    
    for (const contentBlock of sortedContent) {
      const bestMatch = this.findBestTemplateMatch(
        contentBlock, 
        sortedTemplate, 
        templateIndex
      );

      if (bestMatch) {
        mappings[contentBlock.type + 's']?.push({
          content: contentBlock,
          template: bestMatch.node,
          confidence: bestMatch.confidence,
          strategy: bestMatch.strategy
        });
        templateIndex = bestMatch.nextIndex;
      } else {
        mappings.unmatched_content.push(contentBlock);
      }
    }

    return mappings;
  }

  findBestTemplateMatch(contentBlock, templateNodes, startIndex) {
    if (contentBlock.type === 'figure') {
      return this.findImageMatch(contentBlock, templateNodes, startIndex);
    } else if (contentBlock.type === 'paragraph') {
      return this.findParagraphMatch(contentBlock, templateNodes, startIndex);
    }
    return null;
  }

  findImageMatch(figureBlock, templateNodes, startIndex) {
    // Look for image nodes starting from startIndex
    for (let i = startIndex; i < templateNodes.length; i++) {
      const node = templateNodes[i];
      
      if (node.element_type === 'image') {
        return {
          node,
          confidence: this.calculateImageMatchConfidence(figureBlock, node, i - startIndex),
          strategy: 'sequential_image_matching',
          nextIndex: i + 1
        };
      }
    }

    // Fallback: find any available image node
    const availableImages = templateNodes.filter(n => n.element_type === 'image');
    if (availableImages.length > 0) {
      const closestImage = this.findClosestBySize(figureBlock, availableImages);
      return {
        node: closestImage,
        confidence: 0.6, // Lower confidence for fallback
        strategy: 'size_based_fallback',
        nextIndex: startIndex + 1
      };
    }

    return null;
  }

  findParagraphMatch(paragraphBlock, templateNodes, startIndex) {
    // Look for paragraph nodes starting from startIndex
    for (let i = startIndex; i < templateNodes.length; i++) {
      const node = templateNodes[i];
      
      if (node.element_type === 'paragraph') {
        return {
          node,
          confidence: this.calculateParagraphMatchConfidence(paragraphBlock, node, i - startIndex),
          strategy: 'sequential_paragraph_matching',
          nextIndex: i + 1
        };
      }
    }

    // Fallback: combine with existing paragraph
    const availableParagraphs = templateNodes.filter(n => n.element_type === 'paragraph');
    if (availableParagraphs.length > 0) {
      const largestParagraph = availableParagraphs.reduce((largest, current) => 
        current.bbox.height > largest.bbox.height ? current : largest
      );
      
      return {
        node: largestParagraph,
        confidence: 0.4, // Low confidence - text will be appended
        strategy: 'text_combination_fallback',
        nextIndex: startIndex + 1
      };
    }

    return null;
  }

  calculateImageMatchConfidence(figureBlock, templateNode, positionOffset) {
    let confidence = 0.8; // Base confidence
    
    // Penalty for position offset
    confidence -= positionOffset * 0.1;
    
    // Bonus for size compatibility (if available in content)
    if (figureBlock.layout_hint?.aspect_ratio && templateNode.bbox) {
      const templateRatio = templateNode.bbox.width / templateNode.bbox.height;
      const ratioMatch = 1 - Math.abs(figureBlock.layout_hint.aspect_ratio - templateRatio) / 2;
      confidence = (confidence + ratioMatch) / 2;
    }
    
    return Math.max(0.1, Math.min(1.0, confidence));
  }

  calculateParagraphMatchConfidence(paragraphBlock, templateNode, positionOffset) {
    let confidence = 0.7; // Base confidence
    
    // Penalty for position offset
    confidence -= positionOffset * 0.15;
    
    // Bonus for text length compatibility
    const textLength = paragraphBlock.text?.length || 0;
    const estimatedNeededHeight = Math.ceil(textLength / 80) * 20; // Rough estimate
    const availableHeight = templateNode.bbox?.height || 100;
    
    if (estimatedNeededHeight <= availableHeight) {
      confidence += 0.2;
    } else {
      confidence -= (estimatedNeededHeight - availableHeight) / availableHeight * 0.3;
    }
    
    return Math.max(0.1, Math.min(1.0, confidence));
  }

  findClosestBySize(contentBlock, templateNodes) {
    // Simple size-based matching as fallback
    return templateNodes[0]; // For now, just return first available
  }

  calculateMappingConfidence(sortedContent, sortedTemplate) {
    const imageCount = sortedContent.filter(b => b.type === 'figure').length;
    const paragraphCount = sortedContent.filter(b => b.type === 'paragraph').length;
    
    const templateImageCount = sortedTemplate.filter(n => n.element_type === 'image').length;
    const templateParagraphCount = sortedTemplate.filter(n => n.element_type === 'paragraph').length;
    
    const imageCoverage = Math.min(imageCount, templateImageCount) / Math.max(imageCount, templateImageCount, 1);
    const paragraphCoverage = Math.min(paragraphCount, templateParagraphCount) / Math.max(paragraphCount, templateParagraphCount, 1);
    
    return (imageCoverage + paragraphCoverage) / 2;
  }

  /**
   * Generate enhanced node mapping for workflow automation
   */
  generateEnhancedMapping(contentBlocks, originalMapping) {
    const smartMapping = this.mapContentToTemplate(contentBlocks, originalMapping.content_elements);
    
    return {
      ...originalMapping,
      smart_mapping: {
        strategy: 'bbox_visual_proximity',
        confidence: smartMapping.confidence,
        mappings: smartMapping.mappings,
        generated_at: new Date().toISOString()
      },
      mapping_algorithm: 'v2_smart_visual_layout'
    };
  }

  /**
   * Handle content overflow with dynamic card creation
   */
  generateCardExpansionPlan(contentGroups, availableCards) {
    const requiredCards = Object.keys(contentGroups).length;
    const expansionPlan = [];
    
    if (requiredCards > availableCards) {
      for (let i = availableCards; i < requiredCards; i++) {
        expansionPlan.push({
          action: 'append_card_to_container',
          template_source: 0, // Use first card as template
          insert_position: -1, // Append at end
          content_group_index: i
        });
      }
    }
    
    return {
      required_cards: requiredCards,
      available_cards: availableCards,
      expansion_needed: requiredCards > availableCards,
      expansion_plan: expansionPlan
    };
  }
}

export default SmartMappingAlgorithm;

// CLI testing
if (import.meta.url === `file://${process.argv[1]}`) {
  const algorithm = new SmartMappingAlgorithm();
  
  console.log(`
Smart Mapping Algorithm - bbox智能索引增强

Features:
- Visual layout-based content mapping
- Proximity-aware node matching  
- Dynamic card expansion planning
- Confidence scoring for mappings

Usage:
  import SmartMappingAlgorithm from './smart-mapping-algorithm.js'
  const mapper = new SmartMappingAlgorithm();
  const result = mapper.mapContentToTemplate(content, template);
  `);
}