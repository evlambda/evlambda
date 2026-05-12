<?xml version="1.0"?>
<!-- SPDX-FileCopyrightText: Copyright (c) 2024-2026 Raphaël Van Dyck -->
<!-- SPDX-License-Identifier: BSD-3-Clause -->
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="html" doctype-system="about:legacy-compat" encoding="utf-8"/>
  <xsl:param name="cssURL"/>
  <xsl:param name="jsURL"/>
  <xsl:param name="windowId"/>
  <xsl:template match="node()|@*">
    <xsl:copy>
      <xsl:apply-templates select="node()|@*"/>
    </xsl:copy>
  </xsl:template>
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
  <xsl:template match="repl">
    <pre class="repl">
      <xsl:apply-templates/>
    </pre>
  </xsl:template>
  <xsl:template match="table">
    <table class="plain">
      <xsl:apply-templates/>
    </table>
  </xsl:template>
  <xsl:template match="ebnf">
    <table class="ebnf">
      <xsl:apply-templates/>
    </table>
  </xsl:template>
  <xsl:template match="lhs">
    <td class="lhs">
      <xsl:apply-templates/>
    </td>
  </xsl:template>
  <xsl:template match="def">
    <td class="def">
      <xsl:apply-templates/>
    </td>
  </xsl:template>
  <xsl:template match="rhs">
    <td class="rhs">
      <xsl:apply-templates/>
    </td>
  </xsl:template>
  <xsl:template match="specialform">
    <p>Special form: <code class="bg"><xsl:apply-templates/></code></p>
  </xsl:template>
  <xsl:template match="macrocall">
    <p>Macro call: <code class="bg"><xsl:apply-templates/></code></p>
  </xsl:template>
  <xsl:template match="plainfunctioncall">
    <p>Plain function call: <code class="bg"><xsl:apply-templates/></code></p>
  </xsl:template>
  <xsl:template match="primitivefunction">
    <p>Primitive function: <code class="bg"><xsl:apply-templates/></code></p>
  </xsl:template>
  <xsl:template match="macro">
    <p>Macro: <code class="bg"><xsl:apply-templates/></code></p>
  </xsl:template>
  <xsl:template match="nonprimitivefunction">
    <p>Nonprimitive function: <code class="bg"><xsl:apply-templates/></code></p>
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
