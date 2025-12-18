<?xml version="1.0"?>
<!-- SPDX-FileCopyrightText: Copyright (c) 2024-2025 Raphaël Van Dyck -->
<!-- SPDX-License-Identifier: BSD-3-Clause -->
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="html" doctype-system="about:legacy-compat" encoding="utf-8"/>
  <xsl:param name="cssURL"/>
  <xsl:param name="jsURL"/>
  <xsl:param name="windowId"/>
  <xsl:template match="/chapter">
    <html>
      <head>
        <meta charset="utf-8"/>
        <link rel="stylesheet" href="{$cssURL}"/>
        <script src="{$jsURL}"></script>
        <script>const windowId = <xsl:value-of select="$windowId"/>;</script>
      </head>
      <body>
        <h1><xsl:apply-templates select="title"/></h1>
        <xsl:apply-templates select="*[not(self::title)]"/>
      </body>
    </html>
  </xsl:template>
  <xsl:template match="/chapter/section">
    <h2><xsl:apply-templates select="title"/></h2>
    <xsl:apply-templates select="*[not(self::title)]"/>
  </xsl:template>
  <xsl:template match="/chapter/section/section">
    <h3><xsl:apply-templates select="title"/></h3>
    <xsl:apply-templates select="*[not(self::title)]"/>
  </xsl:template>
  <xsl:template match="/chapter/section/section/section">
    <h4><xsl:apply-templates select="title"/></h4>
    <xsl:apply-templates select="*[not(self::title)]"/>
  </xsl:template>
  <xsl:template match="/chapter/section/section/section/section">
    <h5><xsl:apply-templates select="title"/></h5>
    <xsl:apply-templates select="*[not(self::title)]"/>
  </xsl:template>
  <xsl:template match="/chapter/section/section/section/section/section">
    <h6><xsl:apply-templates select="title"/></h6>
    <xsl:apply-templates select="*[not(self::title)]"/>
  </xsl:template>
  <xsl:template match="title">
    <xsl:apply-templates/>
  </xsl:template>
  <xsl:template match="para">
    <p>
      <xsl:apply-templates/>
    </p>
  </xsl:template>
  <xsl:template match="code">
    <code>
      <xsl:apply-templates/>
    </code>
  </xsl:template>
  <xsl:template match="syntax">
    <p class="syntax">
      <span>Syntax: <code><xsl:apply-templates/></code></span>
    </p>
  </xsl:template>
  <xsl:template match="primitivefunction">
    <p class="primitivefunction">
      <span>Primitive function: <code><xsl:apply-templates/></code></span>
    </p>
  </xsl:template>
  <xsl:template match="macro">
    <p class="macro">
      <span>Macro: <code><xsl:apply-templates/></code></span>
    </p>
  </xsl:template>
  <xsl:template match="function">
    <p class="function">
      <span>Function: <code><xsl:apply-templates/></code></span>
    </p>
  </xsl:template>
  <xsl:template match="toplevelcode">
    <xsl:apply-templates/>
  </xsl:template>
  <xsl:template match="blockcode">
    <pre class="blockcode">
      <xsl:apply-templates/>
    </pre>
  </xsl:template>
  <xsl:template match="indentation">
    <div class="indentation" style="{@style}">
      <xsl:apply-templates/>
    </div>
  </xsl:template>
  <xsl:template match="blockcomment">
    <div class="blockcomment">
      <xsl:apply-templates/>
    </div>
  </xsl:template>
  <xsl:template match="comment">
    <span class="eolcomment">
      <xsl:apply-templates/>
    </span>
  </xsl:template>
</xsl:stylesheet>
