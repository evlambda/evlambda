// SPDX-FileCopyrightText: Copyright (c) 2024 Raphaël Van Dyck
// SPDX-License-Identifier: BSD-3-Clause

import React from 'react';

import * as Menubar from '@radix-ui/react-menubar';
import * as Toolbar from '@radix-ui/react-toolbar';
import * as Dialog from '@radix-ui/react-dialog';

import {
  DotFilledIcon
} from '@radix-ui/react-icons';

import './styles.scss';

/**************/
/* TextButton */
/**************/

export function TextButton({onClick, children}) {
  return (
    <button className="textButton"
            onClick={onClick}>
      {children}
    </button>
  );
}

/****************/
/* FilledButton */
/****************/

export function FilledButton({onClick, children}) {
  return (
    <button className="filledButton"
            onClick={onClick}>
      {children}
    </button>
  );
}

/***********/
/* Menubar */
/***********/

export function MenubarRoot({value, onValueChange, children}) {
  return (
    <Menubar.Root className="menubarRoot"
                  value={value}
                  onValueChange={onValueChange}>
      {children}
    </Menubar.Root>
  );
}

export function MenubarMenu({trigger, hidden = false, children}) {
  return (
    <Menubar.Menu>
      <Menubar.Trigger className="menubarTrigger">
        {trigger}
      </Menubar.Trigger>
      <Menubar.Portal>
        <Menubar.Content className="menubarContent"
                         hidden={hidden}
                         onCloseAutoFocus={event => event.preventDefault()}>
          {children}
        </Menubar.Content>
      </Menubar.Portal>
    </Menubar.Menu>
  );
}

export function MenubarItem({inset = false, disabled = false, onSelect, children}) {
  return (
    <Menubar.Item className={inset ? 'menubarItem inset' : 'menubarItem'}
                  disabled={disabled}
                  onSelect={onSelect}>
      {children}
    </Menubar.Item>
  );
}

export function MenubarDialog({open, onOpenChange, inset = false, disabled = false, onClose, title, children}) {
  const focusDialogDefaultButton = event => {
    event.currentTarget.querySelector('button.dialogButton.default').focus();
    event.preventDefault();
  };
  return (
    <Dialog.Root open={open}
                 onOpenChange={x => onOpenChange(x && !disabled)}>
      <Dialog.Trigger asChild>
        <Menubar.Item className={inset ? 'menubarItem inset' : 'menubarItem'}
                      disabled={disabled}
                      onSelect={event => event.preventDefault()}>
          {title}
        </Menubar.Item>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialogOverlay"/>
        <Dialog.Content className="dialogContent"
                        onOpenAutoFocus={focusDialogDefaultButton}
                        onEscapeKeyDown={onClose}
                        onInteractOutside={onClose}>
          <Dialog.Title className="dialogTitle">
            {title}
          </Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function MenubarRadioGroup({value, children}) {
  return (
    <Menubar.RadioGroup value={value}>
      {children}
    </Menubar.RadioGroup>
  );
}

export function MenubarRadioItem({value, disabled = false, onSelect, children}) {
  return (
    <Menubar.RadioItem className="menubarItem inset"
                       value={value}
                       disabled={disabled}
                       onSelect={onSelect}>
      <Menubar.ItemIndicator className="menubarItemIndicator">
        <DotFilledIcon/>
      </Menubar.ItemIndicator>
      {children}
    </Menubar.RadioItem>
  );
}

export function MenubarRightSlot({children}) {
  return (
    <div className="menubarRightSlot">
      {children}
    </div>
  );
}

export function MenubarSeparator() {
  return (
    <Menubar.Separator className="menubarSeparator"/>
  );
}

/***********/
/* Infobar */
/***********/

export function InfobarRoot({children}) {
  return (
    <div className="infobarRoot">
      {children}
    </div>
  );
}

export function InfobarItem({children}) {
  return (
    <div className="infobarItem">
      {children}
    </div>
  );
}

/**********/
/* Window */
/**********/

export function TilingWindow({onFocus, sectionRectangle, position, children}) {
  if (sectionRectangle === null) {
    return null;
  }
  const style = position === null ? {display: 'none'} : windowRectangle(sectionRectangle, position);
  return (
    <div className="tilingWindow"
         onFocus={onFocus}
         style={style}>
      {children}
    </div>
  );
}

function windowRectangle(sectionRectangle, position) {
  let top = 1; // top 1px border
  let left = 0;
  let width = sectionRectangle.width;
  let height = sectionRectangle.height - 2; // top and bottom 1px border
  for (const char of position) {
    switch (char) {
      case 'T':
        height = (height - 1) / 2;
        break;
      case 'B':
        top = top + (height - 1) / 2 + 1;
        height = (height - 1) / 2;
        break;
      case 'L':
        width = (width - 1) / 2;
        break;
      case 'R':
        left = left + (width - 1) / 2 + 1;
        width = (width - 1) / 2;
        break;
    }
  }
  return {top: top, left: left, width: width, height: height};
}

export function FillingWindow({onFocus, children}) {
  return (
    <div className="fillingWindow"
         onFocus={onFocus}>
      {children}
    </div>
  );
}

export function WindowToolbar({children}) {
  return (
    <div className="windowToolbar">
      {children}
    </div>
  );
}

export function WindowContentsArea({children}) {
  return (
    <div className="windowContentsArea">
      {children}
    </div>
  );
}

export function WindowStatusbar({children}) {
  return (
    <div className="windowStatusbar">
      {children}
    </div>
  );
}

/***********/
/* Toolbar */
/***********/

export function ToolbarRoot({dataSelected, children}) {
  return (
    <Toolbar.Root className="toolbarRoot"
                  data-selected={dataSelected}>
      {children}
    </Toolbar.Root>
  );
}

export function ToolbarButton({onClick, children}) {
  return (
    <Toolbar.Button className="toolbarButton"
                    onClick={onClick}>
      {children}
    </Toolbar.Button>
  );
}

/****************/
/* ContentsArea */
/****************/

export function ContentsAreaRoot({children}) {
  return (
    <div className="contentsAreaRoot">
      {children}
    </div>
  );
}

/*************/
/* Statusbar */
/*************/

export function StatusbarRoot({dataSelected, children}) {
  return (
    <div className="statusbarRoot"
         data-selected={dataSelected}>
      {children}
    </div>
  );
}

/**********/
/* Dialog */
/**********/

export function DialogButtons({children}) {
  return (
    <div className="dialogButtons">
      {children}
    </div>
  );
}

export function DialogButton({onClick, children}) {
  return (
    <Dialog.Close asChild>
      <button className="dialogButton"
              onClick={onClick}>
        {children}
      </button>
    </Dialog.Close>
  );
}

export function DialogDefaultButton({onClick, children}) {
  return (
    <Dialog.Close asChild>
      <button className="dialogButton default"
              onClick={onClick}>
        {children}
      </button>
    </Dialog.Close>
  );
}

/*********/
/* Blank */
/*********/

export function Blank({id}) {
  return (
    <div className="cm-outer-container">
      <div className="cm-inner-container">
        <div id={id}>
        </div>
      </div>
    </div>
  );
}

/**********/
/* IFrame */
/**********/

export function IFrame({id, src}) {
  return (
    <div className="cm-outer-container">
      <div className="cm-inner-container">
        <iframe id={id}
                src={src}>
        </iframe>
      </div>
    </div>
  );
}
